import { resolveChangeRequestLinkTarget } from "@supaterm/client-runtime/change-request-links";
import type { EnvironmentProject } from "@supaterm/client-runtime/state/shell";
import { EnvironmentId, ProjectId } from "@supaterm/contracts";

export function nativePullRequestDestination(
  url: string,
  context: { environmentId: string; projectId: string } | null,
  projects: ReadonlyArray<Pick<EnvironmentProject, "id" | "environmentId" | "repositoryIdentity">>,
  configLoaded: (environmentId: EnvironmentId) => boolean,
) {
  if (!context) return null;
  const target = resolveChangeRequestLinkTarget({
    url,
    projects,
    configLoaded,
    environmentId: EnvironmentId.make(context.environmentId),
    projectId: ProjectId.make(context.projectId),
    lendHostProject: true,
  });
  if (target === null) return null;
  return {
    environmentId: context.environmentId,
    projectId: String(target.project.id),
    repository: target.repository,
    number: target.number,
    ...(target.host === undefined ? {} : { host: target.host }),
  };
}
