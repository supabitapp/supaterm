import type {
  OrchestrationV2PendingBackgroundTask,
  OrchestrationV2ProviderGoal,
  ScopedThreadRef,
  ThreadId,
} from "@supaterm/contracts";
import type { EnvironmentThreadShell } from "@supaterm/client-runtime/state/shell";
import {
  presentPendingBackgroundWork,
  presentProviderGoal,
} from "@supaterm/client-runtime/state/thread-execution";
import { childThreadInputsTitle } from "@supaterm/client-runtime/state/threads";
import { GitBranchIcon, MessageCircleIcon, ShieldAlertIcon, TargetIcon } from "@supaterm/icons";
import { Fragment } from "react";
import { InlineConfirmButton } from "../InlineConfirm";
import { Button, InlineButton } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { BackgroundWorkIcon, BackgroundWorkTitle, type WatchedRunProps } from "./BackgroundWork";
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
    actions: isWorking ? undefined : (
      <>
        {presentation.canResume ? (
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

export function backgroundWorkBannerItem(input: {
  readonly threadId: ThreadId;
  readonly threadRef: ScopedThreadRef | null;
  readonly tasks: ReadonlyArray<OrchestrationV2PendingBackgroundTask>;
  /** The workflow run the work watches; it colors the dot and opens its checks. */
  readonly watchedRun: WatchedRunProps;
  readonly stopDisabled: boolean;
  readonly stopping: boolean;
  readonly onStop: () => Promise<void>;
  readonly onOpenThread: (threadId: ThreadId) => void;
}): ComposerBannerStackItem | null {
  const { onOpenThread, watchedRun } = input;
  const presentation = presentPendingBackgroundWork(input.tasks);
  if (presentation === null) return null;
  return {
    id: `background-work:${input.threadId}`,
    variant: "default",
    priority: "activity",
    icon: (
      <BackgroundWorkIcon
        {...watchedRun}
        waiting={presentation.waiting}
        threadRef={input.threadRef}
      />
    ),
    iconInteractive: watchedRun.run !== null,
    title: <BackgroundWorkTitle {...watchedRun} title={presentation.title} />,
    description:
      presentation.items.length === 1 && presentation.items[0]?.childThreadId === undefined
        ? undefined
        : presentation.items.map((item, index) => {
            const childThreadId = item.childThreadId;
            const separator = index < presentation.items.length - 1 ? "," : null;
            return (
              <Fragment key={item.taskId}>
                {index > 0 ? " " : null}
                {childThreadId === undefined ? (
                  <>
                    {item.label}
                    {separator}
                  </>
                ) : (
                  <span className="whitespace-nowrap">
                    <InlineButton
                      tone="muted"
                      aria-label={`${presentation.items.length === 1 ? "Show" : "Open"} subagent ${item.label}`}
                      onClick={() => onOpenThread(childThreadId)}
                    >
                      {presentation.items.length === 1 ? "Show" : item.label}
                    </InlineButton>
                    {separator}
                  </span>
                )}
              </Fragment>
            );
          }),
    actions: (
      <Button
        size="xs"
        variant="ghost"
        disabled={input.stopDisabled}
        onClick={() => void input.onStop()}
      >
        {input.stopping ? "Stopping..." : "Stop"}
      </Button>
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
