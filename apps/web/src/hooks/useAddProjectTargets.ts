import { canCreateProjectInEnvironment } from "@supaterm/client-runtime/operations/projects";
import type { EnvironmentProject } from "@supaterm/client-runtime/state/shell";
import { AuthSourceControlWriteScope, resolveEnvironmentMachineKind } from "@supaterm/contracts";

import type { EnvironmentOption } from "../components/BranchToolbar.logic";
import { useEnvironments } from "../state/environments";
import { useEnvironmentsWithScope } from "../state/session";

export type AddProjectTarget = Pick<EnvironmentOption, "environmentId" | "label" | "machine">;

/**
 * Connected machines that do not have the project yet and can clone it.
 * `projectEnvironments` is the project's current machine list, from
 * `useLogicalProjectEnvironments`. Projects without a git remote get none.
 */
export function useAddProjectTargets(
  project: EnvironmentProject | null,
  projectEnvironments: readonly Pick<EnvironmentOption, "environmentId">[] | undefined,
): readonly AddProjectTarget[] {
  const { environments } = useEnvironments();
  const canClone = useEnvironmentsWithScope(environments, AuthSourceControlWriteScope);
  if (!project?.repositoryIdentity?.locator.remoteUrl) return [];
  const hasProject = new Set([
    project.environmentId,
    ...(projectEnvironments ?? []).map((env) => env.environmentId),
  ]);
  return environments
    .filter(
      (environment) =>
        !hasProject.has(environment.environmentId) &&
        canClone.has(environment.environmentId) &&
        canCreateProjectInEnvironment(environment.connection.phase),
    )
    .map((environment) => ({
      environmentId: environment.environmentId,
      label: environment.label,
      machine: resolveEnvironmentMachineKind(environment.serverConfig),
    }))
    .toSorted((a, b) => a.label.localeCompare(b.label));
}
