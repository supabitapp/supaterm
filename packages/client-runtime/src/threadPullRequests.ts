import { makeThreadPullRequests } from "@supaterm/source-control-core/shared/threadPullRequests";

import type { EnvironmentThreadShell } from "./state/models.ts";
import { sourceControlClients } from "./sourceControlClients.ts";

export {
  threadPullRequestSearchTerms,
  visibleThreadPullRequests,
} from "@supaterm/shared/threadPullRequests";
export {
  pullRequestListLines,
  type PullRequestListLine,
  type ThreadCurrentPullRequest,
  type ThreadPullRequestBadge,
  type ThreadPullRequestChain,
} from "@supaterm/source-control-core/shared/threadPullRequests";

export const {
  normalizeThreadPullRequestKey,
  legacyThreadPullRequestKey,
  threadPullRequestKeysEqual,
  threadPullRequestKeyOf,
  resolveThreadCurrentPullRequest,
  resolveThreadCurrentPullRequestLink,
  resolveThreadPullRequestChains,
  resolveThreadPullRequestBadge,
  threadPullRequestsOf,
  applyThreadPullRequestLinkUpdate,
} = makeThreadPullRequests(sourceControlClients);

/** The server refuses new watches on Done, archived, and subagent threads. */
export function canStartThreadPullRequestWatch(
  thread: Pick<EnvironmentThreadShell, "archivedAt" | "doneAt" | "doneOverride" | "lineage">,
): boolean {
  return (
    thread.archivedAt === null &&
    thread.doneAt === null &&
    thread.doneOverride !== "done" &&
    thread.lineage.relationshipToParent !== "subagent"
  );
}
