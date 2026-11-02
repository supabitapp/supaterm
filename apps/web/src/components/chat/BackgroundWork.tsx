import type {
  EnvironmentId,
  ProjectId,
  ScopedThreadRef,
  ThreadId,
  ThreadWorkflowRunKey,
} from "@supaterm/contracts";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";
import { orchestrationEnvironment } from "~/state/orchestration";
import { pullRequestEnvironment } from "~/state/pullRequests";
import { useEnvironmentQuery } from "~/state/query";

import { PullRequestChecksDetails } from "../pullRequest/PullRequestChecksPopover";
import {
  pullRequestChecksState,
  pullRequestChecksStatePresentation,
  pullRequestChecksStateRingToneClassName,
} from "../pullRequest/pullRequestPresentation";
import { Popover, type PopoverCreateHandle, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { CommandOutputPanel } from "./CommandOutputPanel";

type PopoverHandle = ReturnType<typeof PopoverCreateHandle>;

export interface WatchedRunProps {
  /** The run the banner's work watches, when it watches exactly one. */
  run: ThreadWorkflowRunKey | null;
  environmentId: EnvironmentId;
  projectId: ProjectId;
  /** Shared by the dot and the title, so either opens the one checks popover. */
  handle: PopoverHandle;
}

function useWatchedRun({ run, environmentId, projectId }: WatchedRunProps) {
  const { data: workflowRun } = useEnvironmentQuery(
    run === null
      ? null
      : pullRequestEnvironment.workflowRun({
          environmentId,
          input: { projectId, host: run.host, repository: run.repository, runId: run.runId },
        }),
  );
  const checksState = workflowRun ? pullRequestChecksState(workflowRun.checks) : null;
  return workflowRun && checksState !== null ? { workflowRun, checksState } : null;
}

function RunChecksTrigger({
  handle,
  label,
  className,
  children,
}: {
  handle: PopoverHandle;
  label?: string;
  className: string;
  children: ReactNode;
}) {
  return (
    <PopoverTrigger
      handle={handle}
      nativeButton={false}
      openOnHover
      delay={150}
      closeDelay={150}
      {...(label === undefined ? {} : { "aria-label": label })}
      render={<span role="button" tabIndex={0} className={className} />}
    >
      {children}
    </PopoverTrigger>
  );
}

/**
 * The background-work banner's dot. Only work that will wake the agent shows at full strength,
 * since a dev server can run for hours after the agent is done. A watched CI run colors it the way
 * its checks ring would be. It also holds the checks popover the title opens.
 */
export function BackgroundWorkIcon({
  waiting,
  threadRef,
  ...props
}: WatchedRunProps & { waiting: boolean; threadRef: ScopedThreadRef | null }) {
  const watched = useWatchedRun(props);
  const dot = (
    <span
      className={cn(
        "size-1.5 rounded-full",
        watched !== null
          ? ["bg-current", pullRequestChecksStateRingToneClassName(watched.checksState)]
          : waiting
            ? "bg-foreground"
            : "bg-muted-foreground",
      )}
      aria-hidden="true"
    />
  );
  if (watched === null) return dot;
  return (
    <>
      <RunChecksTrigger
        handle={props.handle}
        label={`Checks: ${pullRequestChecksStatePresentation(watched.checksState).label}`}
        className="inline-flex size-full cursor-pointer items-center justify-center"
      >
        {dot}
      </RunChecksTrigger>
      <Popover handle={props.handle}>
        <PopoverPopup align="start" width="md" side="bottom">
          <PullRequestChecksDetails
            checksState={watched.checksState}
            checks={watched.workflowRun.checks}
            threadRef={threadRef}
          />
        </PopoverPopup>
      </Popover>
    </>
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
            <div className="font-mono text-(length:--font-size-code,var(--text-2xs)) leading-relaxed whitespace-pre-wrap break-words select-text">
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

/**
 * The banner's title. It opens the watched run's checks like its dot does, or else the
 * output of the one command it names.
 */
export function BackgroundWorkTitle({
  title,
  output,
  ...props
}: WatchedRunProps & {
  title: string;
  output: { handle: BackgroundTaskOutputHandle; target: BackgroundTaskOutputTarget } | null;
}) {
  const watched = useWatchedRun(props);
  if (watched === null) {
    return output === null ? (
      title
    ) : (
      <PopoverTrigger
        handle={output.handle}
        payload={output.target}
        nativeButton={false}
        render={<span role="button" tabIndex={0} className={titleTriggerClassName} />}
      >
        {title}
      </PopoverTrigger>
    );
  }
  return (
    <RunChecksTrigger handle={props.handle} className={titleTriggerClassName}>
      {title}
    </RunChecksTrigger>
  );
}
