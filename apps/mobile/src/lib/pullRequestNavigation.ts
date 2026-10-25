import { resolveChangeRequestLinkTarget } from "@supaterm/client-runtime/change-request-links";
import type { EnvironmentProject } from "@supaterm/client-runtime/state/shell";
import { EnvironmentId, ProjectId } from "@supaterm/contracts";

/** The PullRequest route for a change request link from a project, or null for the browser. */
export function nativePullRequestDestination(
  url: string,
  context: { environmentId: string; projectId: string } | null,
  projects: ReadonlyArray<Pick<EnvironmentProject, "id" | "environmentId" | "repositoryIdentity">>,
  reads: (environmentId: EnvironmentId) => boolean,
) {
  if (!context) return null;
  const target = resolveChangeRequestLinkTarget({
    url,
    projects,
    reads,
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
    host: target.host,
  };
}
