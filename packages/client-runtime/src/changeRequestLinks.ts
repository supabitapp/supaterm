import type {
  EnvironmentId,
  ProjectId,
  PullRequestRef,
  RepositoryIdentity,
} from "@supaterm/contracts";
import type { ChangeRequestLink } from "@supaterm/source-control-core/shared/definition";

import { sourceControlClients } from "./sourceControlClients.ts";

interface ChangeRequestProject {
  readonly id: ProjectId;
  readonly environmentId: EnvironmentId;
  readonly repositoryIdentity?: RepositoryIdentity | null | undefined;
}

export function findProjectForChangeRequest<Project extends ChangeRequestProject>(
  projects: ReadonlyArray<Project>,
  link: ChangeRequestLink,
): Project | undefined {
  return projects.find((project) => {
    const identity = project.repositoryIdentity;
    return (
      identity?.provider !== undefined &&
      sourceControlClients.get(identity.provider).isChangeRequestInRepository(identity, link)
    );
  });
}

export function findProjectOnChangeRequestHost<Project extends ChangeRequestProject>(
  projects: ReadonlyArray<Project>,
  link: ChangeRequestLink,
): Project | undefined {
  return (
    findProjectForChangeRequest(projects, link) ??
    projects.find((project) => {
      const identity = project.repositoryIdentity;
      return (
        identity?.provider !== undefined &&
        sourceControlClients.get(identity.provider).canReadChangeRequestOnHost(identity, link)
      );
    })
  );
}

export function resolveChangeRequestLinkTarget<Project extends ChangeRequestProject>({
  url,
  projects,
  configLoaded,
  environmentId,
  projectId,
  primaryEnvironmentId,
  lendHostProject,
}: {
  url: string;
  projects: ReadonlyArray<Project>;
  configLoaded: (environmentId: EnvironmentId) => boolean;

  environmentId?: EnvironmentId | undefined;

  projectId?: ProjectId | undefined;
  primaryEnvironmentId?: EnvironmentId | null | undefined;
  lendHostProject: boolean;
}): {
  readonly project: Project;
  readonly repository: string;
  readonly number: number;
  readonly host?: string;
} | null {
  const link = sourceControlClients.parseChangeRequestUrl(url)?.link;
  if (link === undefined) return null;

  const candidates = (
    environmentId === undefined
      ? projects.filter((project) => configLoaded(project.environmentId))
      : projects.filter((project) => project.environmentId === environmentId)
  ).sort(
    (left, right) =>
      Number(right.id === projectId) - Number(left.id === projectId) ||
      Number(right.environmentId === primaryEnvironmentId) -
        Number(left.environmentId === primaryEnvironmentId),
  );
  const project =
    findProjectForChangeRequest(candidates, link) ??
    (lendHostProject ? findProjectOnChangeRequestHost(candidates, link) : undefined);
  if (project === undefined || !configLoaded(project.environmentId)) return null;
  return {
    project,
    repository: link.repository,
    number: link.number,
    host: link.authority ?? link.host,
  };
}

export function resolvePullRequestPreviewTarget({
  environmentId,
  projects,
  pullRequestsEnabled,
  url,
}: {
  environmentId: EnvironmentId | null;
  projects: ReadonlyArray<ChangeRequestProject>;
  pullRequestsEnabled: boolean;
  url: string;
}): { environmentId: EnvironmentId; input: PullRequestRef } | null {
  if (!pullRequestsEnabled || environmentId === null) return null;
  const parsed = sourceControlClients.parseChangeRequestUrl(url)?.link;
  if (parsed === undefined) return null;
  const project = findProjectForChangeRequest(
    projects.filter((candidate) => candidate.environmentId === environmentId),
    parsed,
  );
  if (project === undefined) return null;
  return {
    environmentId,
    input: {
      projectId: project.id,
      host: parsed.authority ?? parsed.host,
      repository:
        sourceControlClients.repositorySelector(project.repositoryIdentity) ?? parsed.repository,
      number: parsed.number,
    },
  };
}

export function projectChangeRequestUrl(
  identity: RepositoryIdentity | null | undefined,
  repository: string,
  number: number,
): string | null {
  if (identity?.provider === undefined) return null;
  const [host, ...path] = identity.canonicalKey.split("/");
  if (!host) return null;

  const ownRepository = sourceControlClients.repositorySelector(identity) === repository;
  return sourceControlClients.get(identity.provider).changeRequestUrl({
    host,
    repository: ownRepository ? path.join("/") : repository,
    number,
    remoteUrl: identity.locator.remoteUrl.trim(),
    ...(ownRepository && identity.webUrl !== undefined ? { webUrl: identity.webUrl } : {}),
  });
}
