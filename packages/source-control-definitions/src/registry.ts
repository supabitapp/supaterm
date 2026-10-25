import * as AzureDevOps from "@supaterm/source-control-azure-devops/shared/definition";
import * as Bitbucket from "@supaterm/source-control-bitbucket/shared/definition";
import { makeSourceControlDefinitionRegistry } from "@supaterm/source-control-core/shared/definition";
import * as Forgejo from "@supaterm/source-control-forgejo/shared/definition";
import * as GitCafe from "@supaterm/source-control-gitcafe/shared/definition";
import * as GitHub from "@supaterm/source-control-github/shared/definition";
import * as GitLab from "@supaterm/source-control-gitlab/shared/definition";

export { canonicalizePullRequestUrl as canonicalizeGitCafePullRequestUrl } from "@supaterm/source-control-gitcafe/shared/definition";

/**
 * GitHub comes first to preserve the client default for repositories with an unknown host.
 * GitCafe claims URLs first because GitHub and Forgejo accept the same routes on any hostname.
 * Remote recognition needs its own order because host labels can overlap (`gitea.github.example`).
 */
export const builtInSourceControlDefinitions = makeSourceControlDefinitionRegistry(
  [
    GitHub.definition,
    GitLab.definition,
    GitCafe.definition,
    Forgejo.definition,
    Bitbucket.definition,
    AzureDevOps.definition,
  ],
  {
    claimChangeRequestUrlsFirst: [GitCafe.definition.kind],
    recognizeRemotesIn: [
      GitCafe.definition.kind,
      Forgejo.definition.kind,
      GitHub.definition.kind,
      GitLab.definition.kind,
      AzureDevOps.definition.kind,
      Bitbucket.definition.kind,
    ],
  },
);
