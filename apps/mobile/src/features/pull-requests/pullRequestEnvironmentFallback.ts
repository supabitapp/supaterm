import type { EnvironmentProject } from "@supaterm/client-runtime/state/models";
import type { EnvironmentConnectionSummary } from "@supaterm/client-runtime/state/presentation";

export type PullRequestEnvironmentTarget = {
  readonly environmentId: string;
  readonly projectId: string;
  readonly repository: string;
  readonly host?: string;
};

export function pullRequestFallbackEnvironment(
  target: PullRequestEnvironmentTarget,
  projects: ReadonlyArray<EnvironmentProject>,
  environments: ReadonlyArray<
    Pick<EnvironmentConnectionSummary, "environmentId" | "connectionState" | "isEnabled">
  >,
) {
  const requested = environments.find(
    (environment) => environment.environmentId === target.environmentId,
  );

  if (
    requested?.isEnabled &&
    (requested.connectionState === "connected" ||
      requested.connectionState === "available" ||
      requested.connectionState === "connecting" ||
      requested.connectionState === "reconnecting")
  )
    return null;
  const connectedEnvironmentIds = new Set<string>(
    environments.flatMap((environment) =>
      environment.isEnabled && environment.connectionState === "connected"
        ? [environment.environmentId]
        : [],
    ),
  );
  const own = projects.find(
    (project) => project.environmentId === target.environmentId && project.id === target.projectId,
  );
  const host = target.host ?? own?.repositoryIdentity?.canonicalKey.split("/")[0];
  if (!host) return null;
  const key = `${host}/${target.repository}`.toLowerCase();
  const copy = projects.find(
    (project) =>
      project.environmentId !== target.environmentId &&
      connectedEnvironmentIds.has(project.environmentId) &&
      project.repositoryIdentity?.canonicalKey.toLowerCase() === key,
  );
  return copy ? { environmentId: String(copy.environmentId), projectId: String(copy.id) } : null;
}
