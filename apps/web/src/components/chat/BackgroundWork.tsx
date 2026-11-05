import { selectEnvironmentQueryData } from "@supaterm/client-runtime/state/runtime";
import type { EnvironmentId, PullRequestRef, ScopedThreadRef, ThreadId } from "@supaterm/contracts";
import type { AsyncResult } from "effect/reactivity";
import type { ReactElement } from "react";

import { usePullRequestChecksRefresh } from "~/hooks/usePullRequestChecksRefresh";
import { cn } from "~/lib/utils";
import { orchestrationEnvironment } from "~/state/orchestration";
import { pullRequestEnvironment } from "~/state/pullRequests";
import { useEnvironmentQueryRefresh, useEnvironmentQuerySelector } from "~/state/query";

import { PullRequestChecksPopover } from "../pullRequest/PullRequestChecksPopover";
import { pullRequestChecksState } from "../pullRequest/pullRequestPresentation";
import { Popover, type PopoverCreateHandle, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { CommandOutputPanel } from "./CommandOutputPanel";

export interface WatchedPullRequest {
  readonly threadRef: ScopedThreadRef;
  readonly reference: PullRequestRef;
}

/**
 * The background-work banner's dot. Only work that will wake the agent shows at full strength,
 * since a dev server can run for hours after the agent is done. A watched PR shows its checks
 * ring instead, which opens the checks.
 */
export function BackgroundWorkIcon({
  waiting,
  watchedPullRequest,
}: {
  waiting: boolean;
  watchedPullRequest: WatchedPullRequest | null;
}) {
  const dot = (
    <span
      className={cn("size-1.5 rounded-full", waiting ? "bg-foreground" : "bg-muted-foreground")}
      aria-hidden="true"
    />
  );
  return watchedPullRequest === null ? (
    dot
  ) : (
    <WatchedPullRequestChecks watched={watchedPullRequest} fallback={dot} />
  );
}

const isSettledWithoutChecks = (result: AsyncResult.AsyncResult<unknown, unknown>) =>
  result._tag === "Success" && result.value === null;

function WatchedPullRequestChecks({
  watched,
  fallback,
}: {
  watched: WatchedPullRequest;
  fallback: ReactElement;
}) {
  const { threadRef, reference } = watched;
  const { environmentId } = threadRef;
  const checksAtom = pullRequestEnvironment.checks({ environmentId, input: reference });
  const checks = useEnvironmentQuerySelector(checksAtom, selectEnvironmentQueryData)?.checks;
  const settledWithoutChecks = useEnvironmentQuerySelector(checksAtom, isSettledWithoutChecks);
  const checksQuery = useEnvironmentQueryRefresh(checksAtom);
  usePullRequestChecksRefresh({
    refresh: () => {
      if (!checksQuery.isPending()) checksQuery.refresh();
    },
    enabled: !settledWithoutChecks,
    // The thread details PR row polls the same query under this key, so the two share a schedule.
    key: `workspace-pr-checks:${environmentId}:${reference.projectId}:${reference.host}:${reference.repository}:${reference.number}`,
    checks: checks ?? [],
  });
  const checksState = checks === undefined ? null : pullRequestChecksState(checks);
  if (checks === undefined || checksState === null) return fallback;
  return (
    <PullRequestChecksPopover checksState={checksState} checks={checks} threadRef={threadRef} />
  );
}

export interface BackgroundTaskOutputTarget {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly taskId: string;
  readonly label: string;
}

export type BackgroundTaskOutputHandle = ReturnType<
  typeof PopoverCreateHandle<BackgroundTaskOutputTarget>
>;

const titleTriggerClassName =
  "cursor-pointer rounded-sm underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring";

/**
 * The banner's one output popover. Its triggers sit in the banner's text and name the task;
 * the root stays outside that text, which measures itself for overflow.
 */
export function BackgroundTaskOutputPopover({ handle }: { handle: BackgroundTaskOutputHandle }) {
  return (
    <Popover handle={handle}>
      {({ payload }) =>
        payload === undefined ? null : (
          <PopoverPopup side="top" align="start" width="xl" aria-label={`Output: ${payload.label}`}>
            <div className="mb-2 truncate font-medium text-xs">{payload.label}</div>
            {/* Fixed, so the popover keeps its place while output streams in. */}
            <div className="h-80 font-mono text-(length:--font-size-code,var(--text-2xs)) leading-relaxed whitespace-pre-wrap break-words select-text [&_*]:[scrollbar-width:none] [&_*::-webkit-scrollbar]:hidden">
              <CommandOutputPanel
                output={orchestrationEnvironment.v2.backgroundTaskOutput({
                  environmentId: payload.environmentId,
                  input: { threadId: payload.threadId, taskId: payload.taskId },
                })}
                waitingLabel="No output yet."
              />
            </div>
          </PopoverPopup>
        )
      }
    </Popover>
  );
}

export type BackgroundWorkTitleAction =
  | {
      readonly kind: "output";
      readonly handle: BackgroundTaskOutputHandle;
      readonly target: BackgroundTaskOutputTarget;
    }
  | { readonly kind: "thread"; readonly open: () => void };

/** The banner's title. It opens the output of the one command it names, or the one subagent. */
export function BackgroundWorkTitle({
  title,
  action,
}: {
  title: string;
  action: BackgroundWorkTitleAction | null;
}) {
  if (action === null) return title;
  if (action.kind === "thread") {
    return (
      <span
        role="link"
        tabIndex={0}
        className={titleTriggerClassName}
        onClick={action.open}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          action.open();
        }}
      >
        {title}
      </span>
    );
  }
  return (
    <PopoverTrigger
      handle={action.handle}
      payload={action.target}
      nativeButton={false}
      render={<span role="button" tabIndex={0} className={titleTriggerClassName} />}
    >
      {title}
    </PopoverTrigger>
  );
}
