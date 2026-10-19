import type {
  OrchestrationV2AppThread,
  ThreadPullRequestLink,
  ThreadPullRequestWatch,
} from "@supaterm/contracts";

/** The link with its watch replaced, or removed when `watch` is undefined. */
export function withPullRequestWatch(
  link: ThreadPullRequestLink,
  watch: ThreadPullRequestWatch | undefined,
): ThreadPullRequestLink {
  const { watch: previous, endedWatch, ...rest } = link;
  if (watch !== undefined) return { ...rest, watch };
  const ended = previous ?? endedWatch;
  return ended === undefined ? rest : { ...rest, endedWatch: ended };
}

export function endWatches(thread: OrchestrationV2AppThread): OrchestrationV2AppThread {
  return {
    ...thread,
    pullRequests: thread.pullRequests?.map((link) => withPullRequestWatch(link, undefined)),
    ...(thread.workflowRunWatches === undefined ? {} : { workflowRunWatches: [] }),
  };
}

export function withoutInheritedWatches(
  thread: OrchestrationV2AppThread,
): OrchestrationV2AppThread {
  return {
    ...thread,
    pullRequests: thread.pullRequests?.map(
      ({ watch: _watch, endedWatch: _endedWatch, ...link }) => link,
    ),
    ...(thread.workflowRunWatches === undefined ? {} : { workflowRunWatches: [] }),
  };
}
