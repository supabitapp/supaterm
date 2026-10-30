import type { ProjectId, ProjectScript, ServerSettings } from "@supaterm/contracts";

type ProjectScriptSettings = Pick<
  ServerSettings,
  "defaultProjectScripts" | "projectSettingsOverrides" | "projectSettingsFolded"
>;

/**
 * The project's override wins, then environment defaults. Until the project
 * aggregate's own scripts have been folded into `projectSettingsOverrides`,
 * they still count.
 */
export function resolveProjectScripts(
  settings: ProjectScriptSettings,
  project: { id: ProjectId; scripts: readonly ProjectScript[] },
): readonly ProjectScript[] {
  const override = settings.projectSettingsOverrides[project.id]?.defaultProjectScripts;
  if (override !== undefined) return override;
  if (settings.projectSettingsFolded) return settings.defaultProjectScripts;
  return project.scripts.length > 0 ? project.scripts : settings.defaultProjectScripts;
}

interface ProjectScriptRuntimeEnvInput {
  project: {
    cwd: string;
  };
  worktreePath?: string | null;
  extraEnv?: Record<string, string>;
}

export function projectScriptCwd(input: {
  project: {
    cwd: string;
  };
  worktreePath?: string | null;
}): string {
  return input.worktreePath ?? input.project.cwd;
}

export function projectScriptRuntimeEnv(
  input: ProjectScriptRuntimeEnvInput,
): Record<string, string> {
  const env: Record<string, string> = {
    SUPATERM_PROJECT_ROOT: input.project.cwd,
  };
  if (input.worktreePath) {
    env.SUPATERM_WORKTREE_PATH = input.worktreePath;
  }
  if (input.extraEnv) {
    return { ...env, ...input.extraEnv };
  }
  return env;
}

export function setupProjectScript(scripts: readonly ProjectScript[]): ProjectScript | null {
  return scripts.find((script) => script.runOnWorktreeCreate) ?? null;
}

/** Menu label naming the lifecycle roles a script runs in, e.g. "Clean (on done)". */
export function projectScriptMenuLabel(script: ProjectScript): string {
  const roles = [
    ...(script.runOnWorktreeCreate ? ["setup"] : []),
    ...(script.runOnDone ? ["on done"] : []),
  ];
  return roles.length === 0 ? script.name : `${script.name} (${roles.join(", ")})`;
}

export function doneProjectScript(scripts: readonly ProjectScript[]): ProjectScript | null {
  return scripts.find((script) => script.runOnDone === true) ?? null;
}

export function projectScriptTerminalInput(command: string): string {
  return ` ${command}\r`;
}
