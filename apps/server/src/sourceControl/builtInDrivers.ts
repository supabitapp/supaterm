import * as AzureDevOpsCli from "@supaterm/source-control-azure-devops/server/AzureDevOpsCli";
import * as AzureDevOpsPullRequestCli from "@supaterm/source-control-azure-devops/server/AzureDevOpsPullRequestCli";
import * as BitbucketApi from "@supaterm/source-control-bitbucket/server/BitbucketApi";
import * as BitbucketPullRequestApi from "@supaterm/source-control-bitbucket/server/BitbucketPullRequestApi";
import * as ForgejoCli from "@supaterm/source-control-forgejo/server/ForgejoCli";
import * as GitCafeApi from "@supaterm/source-control-gitcafe/server/GitCafeApi";
import * as GitCafeCredentials from "@supaterm/source-control-gitcafe/server/GitCafeCredentials";
import * as GitHubRest from "@supaterm/source-control-github/server/GitHubRest";
import * as GitHubPullRequestApi from "@supaterm/source-control-github/server/GitHubPullRequestApi";
import * as GitLabCli from "@supaterm/source-control-gitlab/server/GitLabCli";
import * as GitLabPullRequestCli from "@supaterm/source-control-gitlab/server/GitLabPullRequestCli";
import type { SourceControlDriver } from "@supaterm/source-control-core/server/driver";
import * as SourceControlRateLimit from "@supaterm/source-control-core/server/SourceControlRateLimit";
import * as Layer from "effect/Layer";

import * as ServerSourceControlHost from "./ServerSourceControlHost.ts";
import { BUILT_IN_SOURCE_CONTROL_DRIVER_LIST as drivers } from "./sourceControlClients.ts";

export type BuiltInSourceControlDriversEnv =
  (typeof drivers)[number] extends SourceControlDriver<infer R> ? R : never;

export const BUILT_IN_SOURCE_CONTROL_DRIVERS: ReadonlyArray<
  SourceControlDriver<BuiltInSourceControlDriversEnv>
> = drivers;

export const layer = Layer.mergeAll(
  // `GitHubRest.layerWithDependencies` carries the quota reserve and rate-limit pause every GitHub
  // reader shares, so the server builds it once, here.
  GitHubPullRequestApi.layer.pipe(Layer.provideMerge(GitHubRest.layerWithDependencies)),
  AzureDevOpsPullRequestCli.layer.pipe(Layer.provideMerge(AzureDevOpsCli.layer)),
  BitbucketPullRequestApi.layer.pipe(
    Layer.provideMerge(BitbucketApi.layer.pipe(Layer.provide(SourceControlRateLimit.layer))),
  ),
  ForgejoCli.layer,
  GitCafeApi.layer.pipe(Layer.provideMerge(GitCafeCredentials.layer)),
  GitLabPullRequestCli.layer.pipe(Layer.provideMerge(GitLabCli.layer)),
).pipe(Layer.provideMerge(ServerSourceControlHost.layer));
