import type {
  PullRequestRef,
  RepositoryIdentity,
  ThreadPullRequestKey,
  OrchestrationProjectShell,
} from "@supaterm/contracts";
import { sourceControlDefinitions } from "../sourceControl/sourceControlDefinitions.ts";
import { normalizeThreadPullRequestKey } from "../sourceControl/threadPullRequests.ts";

export function pullRequestSyncKey(
  reference: Pick<PullRequestRef, "host" | "repository" | "number"> &
    Partial<Pick<PullRequestRef, "projectId">>,
  identity?: RepositoryIdentity | null,
): ThreadPullRequestKey | null {
  const host = identity
    ? sourceControlDefinitions.changeRequestHost(identity, identity.provider)
    : undefined;

  const definition = identity?.provider
    ? sourceControlDefinitions.find(identity.provider)
    : undefined;
  if (identity && definition?.repositorySelector && !reference.repository.includes("/")) {
    if (
      reference.repository.toLowerCase() !==
        definition.repositorySelector(identity)?.toLowerCase() ||
      (reference.host !== undefined && reference.host.toLowerCase() !== host)
    )
      return null;
    const [projectHost, ...repository] = identity.canonicalKey.split("/");
    if (!projectHost || repository.length === 0) return null;
    return normalizeThreadPullRequestKey({
      host: projectHost,
      repository: repository.join("/"),
      number: reference.number,
    });
  }
  const resolvedHost = reference.host ?? host;
  return resolvedHost === undefined
    ? null
    : normalizeThreadPullRequestKey({
        host: resolvedHost,
        repository: reference.repository,
        number: reference.number,
      });
}

function repositoryMatchesPullRequest(
  identity: RepositoryIdentity | null | undefined,
  target: Pick<ThreadPullRequestKey, "host" | "repository">,
) {
  if (identity == null) return false;
  const own = pullRequestSyncKey(
    { repository: sourceControlDefinitions.repositorySelector(identity) ?? "", number: 1 },
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
