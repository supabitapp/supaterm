import * as AzureDevOpsCli from "@supaterm/source-control-azure-devops/server/AzureDevOpsCli";
import * as AzureDevOpsPullRequestCli from "@supaterm/source-control-azure-devops/server/AzureDevOpsPullRequestCli";
import * as AzureDevOpsDriver from "@supaterm/source-control-azure-devops/server/driver";
import * as BitbucketApi from "@supaterm/source-control-bitbucket/server/BitbucketApi";
import * as BitbucketPullRequestApi from "@supaterm/source-control-bitbucket/server/BitbucketPullRequestApi";
import * as BitbucketDriver from "@supaterm/source-control-bitbucket/server/driver";
import * as ForgejoCli from "@supaterm/source-control-forgejo/server/ForgejoCli";
import * as ForgejoDriver from "@supaterm/source-control-forgejo/server/driver";
import * as GitCafeApi from "@supaterm/source-control-gitcafe/server/GitCafeApi";
import * as GitCafeCredentials from "@supaterm/source-control-gitcafe/server/GitCafeCredentials";
import * as GitCafeDriver from "@supaterm/source-control-gitcafe/server/driver";
import * as GitHubRest from "@supaterm/source-control-github/server/GitHubRest";
import * as GitHubPullRequestApi from "@supaterm/source-control-github/server/GitHubPullRequestApi";
import * as GitHubDriver from "@supaterm/source-control-github/server/driver";
import * as GitLabCli from "@supaterm/source-control-gitlab/server/GitLabCli";
import * as GitLabPullRequestCli from "@supaterm/source-control-gitlab/server/GitLabPullRequestCli";
import * as GitLabDriver from "@supaterm/source-control-gitlab/server/driver";
import type { SourceControlDriver } from "@supaterm/source-control-core/server/driver";
import * as Layer from "effect/Layer";

import * as ServerSourceControlHost from "./ServerSourceControlHost.ts";

const drivers = [
  GitHubDriver.driver,
  GitLabDriver.driver,
  AzureDevOpsDriver.driver,
  BitbucketDriver.driver,
  ForgejoDriver.driver,
  GitCafeDriver.driver,
];

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
  BitbucketPullRequestApi.layer.pipe(Layer.provideMerge(BitbucketApi.layer)),
  ForgejoCli.layer,
  GitCafeApi.layer.pipe(Layer.provideMerge(GitCafeCredentials.layer)),
  GitLabPullRequestCli.layer.pipe(Layer.provideMerge(GitLabCli.layer)),
).pipe(Layer.provideMerge(ServerSourceControlHost.layer));
