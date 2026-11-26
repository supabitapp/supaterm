import { formatDuration } from "@supaterm/shared/orchestrationTimingCopy";
import type {
  EnvironmentId,
  OrchestrationV2PendingBackgroundTask,
  OrchestrationV2ProviderGoal,
  OrchestrationV2ProviderSession,
  ProjectId,
  ThreadId,
  ThreadPullRequestLink,
} from "@supaterm/contracts";
import type { EnvironmentThreadShell, ThreadStructure } from "@supaterm/client-runtime/state/shell";
import {
  type PendingBackgroundWorkItem,
  presentPendingBackgroundWork,
  presentProviderGoal,
  type RunStopPresentation,
  soleWatchedPullRequest,
} from "@supaterm/client-runtime/state/thread-execution";
import { childThreadInputsTitle } from "@supaterm/client-runtime/state/threads";
import * as DateTime from "effect/DateTime";
import {
  CircleDashedIcon,
  CircleStopIcon,
  GitBranchIcon,
  MessageCircleIcon,
  PuzzleIcon,
  ShieldAlertIcon,
  TargetIcon,
  TerminalIcon,
  TriangleAlertIcon,
} from "@supaterm/icons";
import { Fragment } from "react";
import { tickTextContent } from "~/lib/tickTextContent";
import { InlineConfirmButton } from "../InlineConfirm";
import { InlineButton } from "../ui/button";
import { PopoverTrigger } from "../ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  type BackgroundTaskOutputHandle,
  BackgroundTaskOutputPopover,
  type BackgroundTaskOutputTarget,
  BackgroundWorkIcon,
  BackgroundWorkTitle,
  type BackgroundWorkTitleAction,
  type WatchedPullRequest,
} from "./BackgroundWork";
import type { ComposerBannerStackItem } from "./ComposerBannerStack";
import type { ThreadNowItem } from "./ThreadNow";
import { msg, T, Var } from "gt-react";
import { m, type MessageResolver } from "~/i18n/messages";

export function extensionStatusBannerItem(
  statuses: NonNullable<OrchestrationV2ProviderSession["extensionStatuses"]>,
): ComposerBannerStackItem | null {
  if (statuses.length === 0) return null;
  return {
    id: "pi-extension-status",
    variant: "default",
    icon: <PuzzleIcon />,
    title: <output>{`Pi · ${statuses.map((status) => status.text).join(" · ")}`}</output>,
  };
}

/** Subagents and side chats waiting on the user, unless the parent is itself waiting on them. */
export function childInputNowItem(input: {
  readonly childThreadInputs: ReadonlyArray<EnvironmentThreadShell>;
  readonly parentAwaitingUser: boolean;
  // A task delegated to a linked environment lives there, not where the parent runs.
  readonly onOpenThread: (threadId: ThreadId, environmentId: EnvironmentId) => void;
}): (ThreadNowItem & { readonly waitingLabel: string }) | null {
  const { childThreadInputs, onOpenThread } = input;
  const first = childThreadInputs[0];
  if (!first || input.parentAwaitingUser) return null;
  return {
    id: `child-input:${first.id}`,
    // The only line at the end of the timeline that needs you gets the info color.
    icon: first.hasPendingApprovals ? (
      <ShieldAlertIcon className="text-info-foreground" />
    ) : (
      <MessageCircleIcon className="text-info-foreground" />
    ),
    title: childThreadInputsTitle(childThreadInputs),
    waitingLabel: childThreadInputs.every((child) => child.lineage.sideChat === true)
      ? msg("Side chat waiting")
      : msg("Subagent waiting"),
    description: childThreadInputs.map((child, index) => (
      <Fragment key={child.id}>
        {index > 0 ? " " : null}
        <span className="whitespace-nowrap">
          <InlineButton tone="muted" onClick={() => onOpenThread(child.id, child.environmentId)}>
            {child.title}
          </InlineButton>
          {index < childThreadInputs.length - 1 ? "," : null}
        </span>
      </Fragment>
    )),
    actions: (
      <InlineButton onClick={() => onOpenThread(first.id, first.environmentId)}>
        {first.hasPendingApprovals ? <T>Open approval</T> : <T>Open question</T>}
      </InlineButton>
    ),
  };
}

/** The thread's goal, for the end of the timeline. */
export function goalNowItem(input: {
  readonly threadId: ThreadId;
  readonly goal: OrchestrationV2ProviderGoal;
  readonly isWorking: boolean;
  readonly onSendCommand: (text: string, failureMessage: string) => Promise<void>;
}): ThreadNowItem {
  const { isWorking, onSendCommand } = input;
  const presentation = presentProviderGoal(input.goal, isWorking);
  return {
    id: `goal:${input.threadId}`,
    icon: <TargetIcon />,
    title:
      presentation.usage === null
        ? presentation.title
        : `${presentation.title} · ${presentation.usage}`,
    description: presentation.objective,
    // Clear stops goal work; Resume would stop unrelated work, so it waits.
    actions: (
      <>
        {presentation.canResume && !isWorking ? (
          <>
            <InlineButton
              onClick={() => void onSendCommand("/goal resume", "Failed to resume goal.")}
            >
              <T context="verb, resumes the goal">Resume</T>
            </InlineButton>
            <span aria-hidden>·</span>
          </>
        ) : null}
        <InlineButton
          tone="muted"
          onClick={() => void onSendCommand("/goal clear", "Failed to clear goal.")}
        >
          <T context="verb, clears the goal">Clear</T>
        </InlineButton>
      </>
    ),
  };
}

/** A Stop the provider has not finished; Force stop once it stops answering. */
export function runStopNowItem(input: {
  readonly threadId: ThreadId;
  readonly stop: RunStopPresentation;
  readonly canForceStop: boolean;
  readonly forceStopping: boolean;
  readonly onForceStop: () => void;
}): ThreadNowItem {
  const unresponsive = input.stop.state === "unresponsive";
  const requestedAtMs = Date.parse(input.stop.requestedAt);
  return {
    id: `run-stop:${input.threadId}`,
    icon: unresponsive ? (
      <TriangleAlertIcon className="text-warning-foreground" />
    ) : (
      <CircleStopIcon />
    ),
    title: unresponsive ? (
      <T>Agent not responding to Stop</T>
    ) : (
      <T context="run status">Stopping</T>
    ),
    description: unresponsive ? (
      <T>It may be short on memory. Force stop kills its processes.</T>
    ) : undefined,
    actions: (
      <>
        <span
          ref={tickTextContent(
            (nowMs) => formatDuration(Math.max(1_000, nowMs - requestedAtMs), m),
            true,
          )}
          className="tabular-nums"
        />
        {unresponsive && input.canForceStop ? (
          <InlineButton disabled={input.forceStopping} onClick={input.onForceStop}>
            {input.forceStopping ? <T>Force stopping...</T> : <T>Force stop</T>}
          </InlineButton>
        ) : null}
      </>
    ),
  };
}

/** Background commands and subagents, for the end of the timeline. */
export function backgroundWorkNowItem(
  input: {
    readonly environmentId: EnvironmentId;
    readonly threadId: ThreadId;
    readonly projectId: ProjectId;
    readonly pullRequests: ReadonlyArray<ThreadPullRequestLink>;
    readonly tasks: ReadonlyArray<OrchestrationV2PendingBackgroundTask>;
    readonly turnItems: ThreadStructure["turnItems"];
    readonly outputHandle: BackgroundTaskOutputHandle;
    readonly stopDisabled: boolean;
    readonly stopping: boolean;
    readonly onStop: () => Promise<void>;
    readonly onOpenThread: (threadId: ThreadId) => void;
  },
  resolve: MessageResolver = m,
): ThreadNowItem | null {
  const { onOpenThread } = input;
  const presentation = presentPendingBackgroundWork(input.tasks);
  if (presentation === null) return null;
  const outputTarget = (item: PendingBackgroundWorkItem): BackgroundTaskOutputTarget => {
    const task = input.tasks.find((candidate) => candidate.taskId === item.taskId);
    return {
      environmentId: input.environmentId,
      threadId: input.threadId,
      taskId: item.taskId,
      label: item.label,
      command: task?.command,
      awaited: task?.awaited === true,
    };
  };
  const rows = presentation.items.map((task) => {
    const itemKey =
      input.tasks.find((pending) => pending.taskId === task.taskId)?.nativeItemId ?? task.taskId;
    // Same key derivePendingBackgroundWork gives turn-item tasks; subagent items carry progress.
    const item = input.turnItems.findLast(
      (candidate) => (candidate.nativeItemRef?.nativeId || candidate.id) === itemKey,
    );
    const subagent = item?.type === "subagent" ? item : undefined;
    return {
      task,
      activity: subagent?.progress?.replace(/\s+/gu, " ").trim() || null,
      startedAtMs: item?.startedAt ? DateTime.toEpochMillis(item.startedAt) : null,
      updatedAtMs: subagent ? DateTime.toEpochMillis(subagent.updatedAt) : 0,
    };
  });
  const [only] = rows.length === 1 ? rows : [];
  const newest = rows
    .filter((row) => row.activity)
    .toSorted((left, right) => right.updatedAtMs - left.updatedAtMs)[0];
  const onlyChildThreadId = only?.task.childThreadId;
  const startedAtMs = only?.startedAtMs ?? null;
  const titleAction: BackgroundWorkTitleAction | null = only?.task.hasOutput
    ? { kind: "output", handle: input.outputHandle, target: outputTarget(only.task) }
    : null;
  const watchedLink = soleWatchedPullRequest(presentation.items, input.pullRequests);
  const watchedPullRequest: WatchedPullRequest | null =
    watchedLink !== null
      ? {
          threadRef: { environmentId: input.environmentId, threadId: input.threadId },
          reference: {
            projectId: input.projectId,
            host: watchedLink.host,
            repository: watchedLink.repository,
            number: watchedLink.number,
          },
        }
      : null;
  return {
    id: `background-work:${input.threadId}`,
    icon: (
      <BackgroundWorkIcon
        icon={
          presentation.items.every((item) => item.kind !== "subagent") ? (
            <TerminalIcon />
          ) : (
            <CircleDashedIcon />
          )
        }
        watchedPullRequest={watchedPullRequest}
      />
    ),
    iconInteractive: watchedPullRequest !== null,
    title: <BackgroundWorkTitle title={presentation.title} action={titleAction} />,
    description: only
      ? only.activity
      : newest
        ? `${newest.task.label}: ${newest.activity}`
        : presentation.items.map((item, index) => {
            const childThreadId = item.childThreadId;
            const separator = index < presentation.items.length - 1 ? "," : null;
            const link =
              childThreadId !== undefined ? (
                <InlineButton
                  tone="muted"
                  aria-label={resolve(msg("Open subagent {label}", { label: item.label }))}
                  onClick={() => onOpenThread(childThreadId)}
                >
                  {item.label}
                </InlineButton>
              ) : item.hasOutput ? (
                <PopoverTrigger
                  handle={input.outputHandle}
                  payload={outputTarget(item)}
                  render={<InlineButton tone="muted" />}
                >
                  {item.label}
                </PopoverTrigger>
              ) : null;
            return (
              <Fragment key={item.taskId}>
                {index > 0 ? " " : null}
                {link === null ? (
                  <>
                    {item.label}
                    {separator}
                  </>
                ) : (
                  <span className="whitespace-nowrap">
                    {link}
                    {separator}
                  </span>
                )}
              </Fragment>
            );
          }),
    actions: (
      <>
        <BackgroundTaskOutputPopover handle={input.outputHandle} />
        {startedAtMs === null ? null : (
          <span
            ref={tickTextContent(
              (nowMs) => formatDuration(Math.max(1_000, nowMs - startedAtMs), m),
              true,
            )}
            className="tabular-nums"
          />
        )}
        {onlyChildThreadId === undefined ? null : (
          <InlineButton tone="muted" onClick={() => onOpenThread(onlyChildThreadId)}>
            <T context="verb, opens the subagent thread">Open</T>
          </InlineButton>
        )}
        <InlineButton disabled={input.stopDisabled} onClick={() => void input.onStop()}>
          {input.stopping ? <T>Stopping...</T> : <T context="verb, stops background work">Stop</T>}
        </InlineButton>
      </>
    ),
  };
}

/** The local checkout moved off the branch this thread last ran on. */
export function branchMismatchBannerItem(
  input: {
    readonly mismatchKey: string;
    readonly mismatch: { readonly threadBranch: string; readonly currentBranch: string };
    readonly restoreDisabled: boolean;
    readonly restoring: boolean;
    /** Uncommitted changes make restoring a two-click confirm. */
    readonly hasWorkingTreeChanges: boolean;
    readonly onRestore: () => void;
    readonly onDismiss: () => void;
  },
  resolve: MessageResolver = m,
): ComposerBannerStackItem {
  const { mismatch } = input;
  const branchTooltip = (
    <Tooltip>
      <TooltipTrigger
        render={
          <code className="min-w-0 truncate font-medium text-foreground">
            {mismatch.threadBranch}
          </code>
        }
      />
      <TooltipPopup side="top">
        <T>
          This thread last ran on <Var>{mismatch.threadBranch}</Var>. Sending will continue on{" "}
          <Var>{mismatch.currentBranch}</Var>.
        </T>
      </TooltipPopup>
    </Tooltip>
  );
  return {
    id: `branch-mismatch:${input.mismatchKey}`,
    variant: "info",
    icon: <GitBranchIcon />,
    title: (
      <span className="flex min-w-0 items-baseline gap-1.5">
        <T>
          <span className="shrink-0 font-normal text-muted-foreground">Branch changed from</span>
          <Var>{branchTooltip}</Var>
        </T>
      </span>
    ),
    actions: (
      <InlineConfirmButton
        size="xs"
        variant="ghost"
        disabled={input.restoreDisabled}
        required={input.hasWorkingTreeChanges}
        label={input.restoring ? resolve(msg("Restoring...")) : resolve(msg("Restore branch"))}
        confirmLabel={resolve(msg("Confirm restore"))}
        tooltip={
          input.hasWorkingTreeChanges ? (
            <T>
              Switch back to <Var>{mismatch.threadBranch}</Var>. You have uncommitted changes.
            </T>
          ) : (
            <T>
              Switch back to <Var>{mismatch.threadBranch}</Var>
            </T>
          )
        }
        confirmTooltip={
          <T>
            Click again to switch to <Var>{mismatch.threadBranch}</Var>. Your uncommitted changes
            will carry over, or block the switch if they conflict.
          </T>
        }
        onConfirm={input.onRestore}
      />
    ),
    dismissLabel: resolve(msg("Dismiss branch change notice")),
    onDismiss: input.onDismiss,
  };
}
