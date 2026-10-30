import { SourceControlProviderKind } from "@supaterm/contracts";
import { defineSourceControlDriver } from "@supaterm/source-control-core/server/driver";
import * as Effect from "effect/Effect";

import * as GitHubPullRequestProvider from "./GitHubPullRequestProvider.ts";
import * as GitHubProviderDiscovery from "./GitHubProviderDiscovery.ts";
import * as GitHubSourceControlProvider from "./GitHubSourceControlProvider.ts";

export const driver = defineSourceControlDriver({
  kind: SourceControlProviderKind.make("github"),
  make: Effect.all({
    sourceControl: GitHubSourceControlProvider.make,
    discovery: GitHubProviderDiscovery.make,
    pullRequests: GitHubPullRequestProvider.make,
  }),
});
