import type {
  EnvironmentId,
  OrchestrationV2PendingBackgroundTask,
  OrchestrationV2ProviderGoal,
  ProjectId,
  ThreadId,
  ThreadPullRequestLink,
} from "@supaterm/contracts";
import type { EnvironmentThreadShell } from "@supaterm/client-runtime/state/shell";
import {
  type PendingBackgroundWorkItem,
  presentPendingBackgroundWork,
  presentProviderGoal,
  type RunStopPresentation,
  soleWatchedPullRequest,
} from "@supaterm/client-runtime/state/thread-execution";
import { childThreadInputsTitle } from "@supaterm/client-runtime/state/threads";
import { formatDuration } from "@supaterm/shared/orchestrationTiming";
import {
  GitBranchIcon,
  MessageCircleIcon,
  ShieldAlertIcon,
  StopFilledIcon,
  TargetIcon,
  TriangleAlertIcon,
} from "@supaterm/icons";
import { Fragment } from "react";
import { tickTextContent } from "~/lib/tickTextContent";
import { InlineConfirmButton } from "../InlineConfirm";
import { Button, InlineButton } from "../ui/button";
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

/** Subagents waiting on the user, unless the parent is itself waiting on them. */
export function childInputBannerItem(input: {
  readonly childThreadInputs: ReadonlyArray<EnvironmentThreadShell>;
  readonly parentAwaitingUser: boolean;
  readonly onOpenThread: (threadId: ThreadId) => void;
}): ComposerBannerStackItem | null {
  const { childThreadInputs, onOpenThread } = input;
  const first = childThreadInputs[0];
  if (!first || input.parentAwaitingUser) return null;
  return {
    id: `child-input:${first.id}`,
    variant: "info",
    priority: "activity",
    announce: true,
    icon: first.hasPendingApprovals ? <ShieldAlertIcon /> : <MessageCircleIcon />,
    title: childThreadInputsTitle(childThreadInputs),
    description: childThreadInputs.map((child, index) => (
      <Fragment key={child.id}>
        {index > 0 ? " " : null}
        <span className="whitespace-nowrap">
          <InlineButton tone="muted" onClick={() => onOpenThread(child.id)}>
            {child.title}
          </InlineButton>
          {index < childThreadInputs.length - 1 ? "," : null}
        </span>
      </Fragment>
    )),
    actions: (
      <Button size="xs" variant="ghost" onClick={() => onOpenThread(first.id)}>
        {first.hasPendingApprovals ? "Open approval" : "Open question"}
      </Button>
    ),
  };
}

export function goalBannerItem(input: {
  readonly threadId: ThreadId;
  readonly goal: OrchestrationV2ProviderGoal;
  readonly isWorking: boolean;
  readonly onSendCommand: (text: string, failureMessage: string) => Promise<void>;
}): ComposerBannerStackItem {
  const { isWorking, onSendCommand } = input;
  const presentation = presentProviderGoal(input.goal, isWorking);
  return {
    id: `goal:${input.threadId}`,
    variant: "default",
    priority: "activity",
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
          <Button
            size="xs"
            variant="ghost"
            onClick={() => void onSendCommand("/goal resume", "Failed to resume goal.")}
          >
            Resume
          </Button>
        ) : null}
        <Button
          size="xs"
          variant="ghost"
          onClick={() => void onSendCommand("/goal clear", "Failed to clear goal.")}
        >
          Clear
        </Button>
      </>
    ),
  };
}

/** A Stop the provider has not finished; Force stop once it stops answering. */
export function runStopBannerItem(input: {
  readonly threadId: ThreadId;
  readonly stop: RunStopPresentation;
  readonly canForceStop: boolean;
  readonly forceStopping: boolean;
  readonly onForceStop: () => void;
}): ComposerBannerStackItem {
  const unresponsive = input.stop.state === "unresponsive";
  const requestedAtMs = Date.parse(input.stop.requestedAt);
  return {
    id: `run-stop:${input.threadId}`,
    variant: unresponsive ? "warning" : "default",
    priority: "activity",
    icon: unresponsive ? <TriangleAlertIcon /> : <StopFilledIcon />,
    title: unresponsive ? "Agent not responding to Stop" : "Stopping",
    description: unresponsive
      ? "It may be short on memory. Force stop kills its processes."
      : undefined,
    actions: (
      <>
        <span
          ref={tickTextContent(
            (nowMs) => formatDuration(Math.max(1_000, nowMs - requestedAtMs)),
            true,
          )}
          className="text-xs text-muted-foreground tabular-nums"
        />
        {unresponsive && input.canForceStop ? (
          <Button
            size="xs"
            variant="ghost"
            disabled={input.forceStopping}
            onClick={input.onForceStop}
          >
            {input.forceStopping ? "Force stopping..." : "Force stop"}
          </Button>
        ) : null}
      </>
    ),
  };
}

export function backgroundWorkBannerItem(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly projectId: ProjectId;
  readonly pullRequests: ReadonlyArray<ThreadPullRequestLink>;
  readonly tasks: ReadonlyArray<OrchestrationV2PendingBackgroundTask>;
  readonly outputHandle: BackgroundTaskOutputHandle;
  readonly stopDisabled: boolean;
  readonly stopping: boolean;
  readonly onStop: () => Promise<void>;
  readonly onOpenThread: (threadId: ThreadId) => void;
}): ComposerBannerStackItem | null {
  const { onOpenThread } = input;
  const presentation = presentPendingBackgroundWork(input.tasks);
  if (presentation === null) return null;
  const outputTarget = (item: PendingBackgroundWorkItem): BackgroundTaskOutputTarget => ({
    environmentId: input.environmentId,
    threadId: input.threadId,
    taskId: item.taskId,
    label: item.label,
  });
  const [only] = presentation.items;
  const onlyChildThreadId = presentation.items.length === 1 ? only?.childThreadId : undefined;
  const titleAction: BackgroundWorkTitleAction | null =
    onlyChildThreadId !== undefined
      ? { kind: "thread", open: () => onOpenThread(onlyChildThreadId) }
      : presentation.items.length === 1 && only?.hasOutput
        ? { kind: "output", handle: input.outputHandle, target: outputTarget(only) }
        : null;
  const title = <BackgroundWorkTitle title={presentation.title} action={titleAction} />;
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
    variant: "default",
    priority: "activity",
    icon: (
      <BackgroundWorkIcon waiting={presentation.waiting} watchedPullRequest={watchedPullRequest} />
    ),
    iconInteractive: watchedPullRequest !== null,
    title:
      presentation.items.length === 1 && (only?.kind === "command" || only?.kind === "monitor") ? (
        <span className="in-data-[slot=popover-popup]:whitespace-pre-wrap">{title}</span>
      ) : (
        title
      ),
    description:
      presentation.items.length === 1
        ? undefined
        : presentation.items.map((item, index) => {
            const childThreadId = item.childThreadId;
            const separator = index < presentation.items.length - 1 ? "," : null;
            const link =
              childThreadId !== undefined ? (
                <InlineButton
                  tone="muted"
                  aria-label={`Open subagent ${item.label}`}
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
        <Button
          size="xs"
          variant="ghost"
          disabled={input.stopDisabled}
          onClick={() => void input.onStop()}
        >
          {input.stopping ? "Stopping..." : "Stop"}
        </Button>
      </>
    ),
  };
}

/** The local checkout moved off the branch this thread last ran on. */
export function branchMismatchBannerItem(input: {
  readonly mismatchKey: string;
  readonly mismatch: { readonly threadBranch: string; readonly currentBranch: string };
  readonly restoreDisabled: boolean;
  readonly restoring: boolean;
  /** Uncommitted changes make restoring a two-click confirm. */
  readonly hasWorkingTreeChanges: boolean;
  readonly onRestore: () => void;
  readonly onDismiss: () => void;
}): ComposerBannerStackItem {
  const { mismatch } = input;
  return {
    id: `branch-mismatch:${input.mismatchKey}`,
    variant: "info",
    icon: <GitBranchIcon />,
    title: (
      <span className="flex min-w-0 items-baseline gap-1.5">
        <span className="shrink-0 font-normal text-muted-foreground">Branch changed from</span>
        <Tooltip>
          <TooltipTrigger
            render={
              <code className="min-w-0 truncate font-medium text-foreground">
                {mismatch.threadBranch}
              </code>
            }
          />
          <TooltipPopup side="top">
            This thread last ran on {mismatch.threadBranch}. Sending will continue on{" "}
            {mismatch.currentBranch}.
          </TooltipPopup>
        </Tooltip>
      </span>
    ),
    actions: (
      <InlineConfirmButton
        size="xs"
        variant="ghost"
        disabled={input.restoreDisabled}
        required={input.hasWorkingTreeChanges}
        label={input.restoring ? "Restoring..." : "Restore branch"}
        confirmLabel="Confirm restore"
        tooltip={
          input.hasWorkingTreeChanges
            ? `Switch back to ${mismatch.threadBranch}. You have uncommitted changes.`
            : `Switch back to ${mismatch.threadBranch}`
        }
        confirmTooltip={`Click again to switch to ${mismatch.threadBranch}. Your uncommitted changes will carry over, or block the switch if they conflict.`}
        onConfirm={input.onRestore}
      />
    ),
    dismissLabel: "Dismiss branch change notice",
    onDismiss: input.onDismiss,
  };
}
