import {
  defineSourceControlDriver,
  withOwnServices,
} from "@supaterm/source-control-core/server/driver";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpClient } from "effect/http";

import { definition } from "../shared/definition.ts";

import * as GitHubMediaFetch from "./gitHubMediaFetch.ts";
import * as GitHubPullRequestApi from "./GitHubPullRequestApi.ts";
import * as GitHubPullRequestProvider from "./GitHubPullRequestProvider.ts";
import * as GitHubProviderDiscovery from "./GitHubProviderDiscovery.ts";
import * as GitHubRest from "./GitHubRest.ts";
import * as GitHubHttpClient from "./GitHubHttpClient.ts";
import * as GitHubSourceControlProvider from "./GitHubSourceControlProvider.ts";

// `GitHubRest.layerWithDependencies` carries the quota reserve every GitHub reader shares, so it
// must be built once; the driver is.
const services = GitHubPullRequestApi.layer.pipe(
  Layer.provideMerge(GitHubRest.layerWithDependencies),
  Layer.provideMerge(GitHubHttpClient.layer),
);

const makeInstance = Effect.gen(function* () {
  const mediaHttpClient = yield* HttpClient.HttpClient;
  return yield* withOwnServices(
    Effect.all({
      sourceControl: GitHubSourceControlProvider.make,
      discovery: GitHubProviderDiscovery.make,
      pullRequests: GitHubPullRequestProvider.make,
      fetchMedia: GitHubMediaFetch.make.pipe(
        Effect.provideService(HttpClient.HttpClient, mediaHttpClient),
      ),
    }),
    services,
  );
});

export const driver = defineSourceControlDriver({
  kind: definition.kind,
  definition,
  make: makeInstance,
});
