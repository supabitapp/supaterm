import { makeThreadPullRequests } from "@supaterm/source-control-core/shared/threadPullRequests";

import { sourceControlClients } from "./sourceControlClients.ts";

import { threadPullRequestSearchTerms as collectThreadPullRequestSearchTerms } from "@supaterm/shared/threadPullRequests";

export { visibleThreadPullRequests } from "@supaterm/shared/threadPullRequests";
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

export function threadPullRequestSearchTerms(
  thread: Parameters<typeof threadPullRequestsOf>[0],
): string[] {
  const pullRequests = threadPullRequestsOf(thread);
  return collectThreadPullRequestSearchTerms({
    pullRequests,
    ...(pullRequests.length === 0 ? { branchPullRequest: thread.linkedPullRequest } : {}),
  });
}
