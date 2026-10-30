import { SourceControlProviderKind } from "@supaterm/contracts";
import { defineSourceControlDriver } from "@supaterm/source-control-core/server/driver";
import * as Effect from "effect/Effect";

import * as ForgejoPullRequestProvider from "./ForgejoPullRequestProvider.ts";
import * as ForgejoSourceControlProvider from "./ForgejoSourceControlProvider.ts";

export const driver = defineSourceControlDriver({
  kind: SourceControlProviderKind.make("forgejo"),
  make: Effect.all({
    sourceControl: ForgejoSourceControlProvider.make,
    discovery: ForgejoSourceControlProvider.makeDiscovery,
    pullRequests: ForgejoPullRequestProvider.make,
  }),
});
