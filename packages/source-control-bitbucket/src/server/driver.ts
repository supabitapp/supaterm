import {
  defineSourceControlDriver,
  withOwnServices,
} from "@supaterm/source-control-core/server/driver";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { definition } from "../shared/definition.ts";

import * as BitbucketApi from "./BitbucketApi.ts";
import * as BitbucketPullRequestApi from "./BitbucketPullRequestApi.ts";
import * as BitbucketPullRequestProvider from "./BitbucketPullRequestProvider.ts";
import * as BitbucketSourceControlProvider from "./BitbucketSourceControlProvider.ts";

const services = BitbucketPullRequestApi.layer.pipe(
  Layer.provideMerge(BitbucketApi.layer),
  Layer.orDie,
);

const makeInstance = Effect.all({
  sourceControl: BitbucketSourceControlProvider.make,
  discovery: BitbucketSourceControlProvider.makeDiscovery,
  pullRequests: BitbucketPullRequestProvider.make,
});

export const driver = defineSourceControlDriver({
  kind: definition.kind,
  definition,
  make: withOwnServices(makeInstance, services),
});
