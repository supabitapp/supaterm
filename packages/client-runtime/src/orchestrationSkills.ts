import type { EnvironmentId, OrchestrationSkillsStatus } from "@supaterm/contracts";

export interface OrchestrationSkillsEnvironment {
  readonly environmentId: EnvironmentId;
  readonly label: string;
}

/** Every selected environment settles independently; one failure cannot hide the others. */
export async function runOrchestrationSkillsAction(
  environments: readonly OrchestrationSkillsEnvironment[],
  execute: (environmentId: EnvironmentId) => Promise<OrchestrationSkillsStatus | null>,
) {
  return Promise.all(
    environments.map(async (environment) => {
      try {
        return { ...environment, status: await execute(environment.environmentId) };
      } catch {
        return { ...environment, status: null };
      }
    }),
  );
}

export function orchestrationSkillsView(status: OrchestrationSkillsStatus | null) {
  const skills = status?.targets.flatMap((target) => target.skills) ?? [];
  return {
    canInstall: skills.some((skill) => skill.state !== "installed"),
    canUninstall: skills.some((skill) => skill.managed && skill.state !== "conflict"),
    installed: skills.length > 0 && skills.every((skill) => skill.state === "installed"),
    conflict: skills.some((skill) => skill.state === "conflict"),
  };
}
