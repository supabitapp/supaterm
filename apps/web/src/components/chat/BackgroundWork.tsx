import type {
  EnvironmentId,
  ProjectId,
  ScopedThreadRef,
  ThreadWorkflowRunKey,
} from "@supaterm/contracts";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";
import { pullRequestEnvironment } from "~/state/pullRequests";
import { useEnvironmentQuery } from "~/state/query";

import { PullRequestChecksDetails } from "../pullRequest/PullRequestChecksPopover";
import {
  pullRequestChecksState,
  pullRequestChecksStatePresentation,
  pullRequestChecksStateRingToneClassName,
} from "../pullRequest/pullRequestPresentation";
import { Popover, type PopoverCreateHandle, PopoverPopup, PopoverTrigger } from "../ui/popover";

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
 * The background-work banner's dot. Work that will wake the agent pulses, and a watched CI run
 * colors it the way its checks ring would be. It also holds the checks popover the title opens.
 */
export function BackgroundWorkIcon({
  waiting,
  threadRef,
  ...props
}: WatchedRunProps & { waiting: boolean; threadRef: ScopedThreadRef | null }) {
  const watched = useWatchedRun(props);
  // A dev server can run for hours after the agent is done, so only work
  // that will wake the agent pulses; a finished run stops.
  const dot = (
    <span
      className={cn(
        "size-1.5 rounded-full",
        watched === null
          ? "bg-foreground"
          : ["bg-current", pullRequestChecksStateRingToneClassName(watched.checksState)],
        waiting &&
          (watched === null || watched.workflowRun.status === "pending") &&
          "animate-status-pulse",
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

/** The banner's title, which opens the watched run's checks like its dot does. */
export function BackgroundWorkTitle({ title, ...props }: WatchedRunProps & { title: string }) {
  const watched = useWatchedRun(props);
  if (watched === null) return title;
  return (
    <RunChecksTrigger
      handle={props.handle}
      className="cursor-pointer rounded-sm underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
    >
      {title}
    </RunChecksTrigger>
  );
}
