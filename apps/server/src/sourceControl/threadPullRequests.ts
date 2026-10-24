import { makeThreadPullRequests } from "@supaterm/source-control-core/client/threadPullRequests";

import { sourceControlClients } from "./sourceControlClients.ts";

export { visibleThreadPullRequests } from "@supaterm/shared/threadPullRequests";

export const {
  normalizeThreadPullRequestKey,
  legacyThreadPullRequestKey,
  threadPullRequestKeysEqual,
  threadPullRequestKeyOf,
  resolveThreadPullRequestChains,
  threadPullRequestsOf,
  applyThreadPullRequestLinkUpdate,
} = makeThreadPullRequests(sourceControlClients);
