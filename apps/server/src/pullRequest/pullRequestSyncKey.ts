import {
  pullRequestHostOf,
  type PullRequestRef,
  type OrchestrationProjectShell,
  type RepositoryIdentity,
  SourceControlProviderKind,
  type ThreadPullRequestKey,
} from "@supaterm/contracts";
import { sourceControlRepositorySelector } from "@supaterm/shared/sourceControl";
import { normalizeThreadPullRequestKey } from "@supaterm/shared/threadPullRequests";

export function pullRequestSyncKey(
  reference: Pick<PullRequestRef, "host" | "repository" | "number"> &
    Partial<Pick<PullRequestRef, "projectId">>,
  identity?: RepositoryIdentity | null,
): ThreadPullRequestKey | null {
  if (identity?.provider === "azure-devops" && !reference.repository.includes("/")) {
    if (
      reference.repository.toLowerCase() !==
        sourceControlRepositorySelector(identity)?.toLowerCase() ||
      (reference.host !== undefined &&
        reference.host.toLowerCase() !==
          pullRequestHostOf(identity, SourceControlProviderKind.make("azure-devops")))
    )
      return null;
    const [host, ...repository] = identity.canonicalKey.split("/");
    if (!host || repository.length === 0) return null;
    return normalizeThreadPullRequestKey({
      host,
      repository: repository.join("/"),
      number: reference.number,
    });
  }
  const host =
    reference.host ??
    (identity
      ? pullRequestHostOf(identity, identity.provider as SourceControlProviderKind)
      : undefined);
  return host === undefined
    ? null
    : normalizeThreadPullRequestKey({
        host,
        repository: reference.repository,
        number: reference.number,
      });
}

export function repositoryMatchesPullRequest(
  identity: RepositoryIdentity | null | undefined,
  target: Pick<ThreadPullRequestKey, "host" | "repository">,
) {
  if (identity == null) return false;
  const own = pullRequestSyncKey(
    { repository: sourceControlRepositorySelector(identity) ?? "", number: 1 },
    identity,
  );
  const requested = pullRequestSyncKey({ ...target, number: 1 }, identity);
  return (
    own !== null &&
    requested !== null &&
    own.host === requested.host &&
    own.repository === requested.repository
  );
}

export function projectForPullRequest(
  projects: ReadonlyArray<OrchestrationProjectShell>,
  target: Pick<ThreadPullRequestKey, "host" | "repository">,
  preferred: OrchestrationProjectShell | undefined,
) {
  const matches = (project: OrchestrationProjectShell) =>
    repositoryMatchesPullRequest(project.repositoryIdentity, target);
  return preferred !== undefined && matches(preferred) ? preferred : projects.find(matches);
}
