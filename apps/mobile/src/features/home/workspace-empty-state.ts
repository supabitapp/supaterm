import { workspaceHasShellSnapshot, type WorkspacePhase } from "../../state/workspaceModel";

interface WorkspaceEmptyState {
  readonly title: string;
  readonly detail: string;
  readonly loading: boolean;
}

const NO_PROJECTS: WorkspaceEmptyState = {
  title: "No projects found",
  detail: "The connected environment did not report any projects.",
  loading: false,
};

function resolveMissingShellEmptyState(
  phase: WorkspacePhase,
  detail: { readonly noEnvironments: string; readonly connecting: string },
): WorkspaceEmptyState | null {
  if (workspaceHasShellSnapshot(phase)) {
    return null;
  }
  switch (phase.type) {
    case "loading-catalog":
      return {
        title: "Loading environments",
        detail: "Checking saved environments on this device.",
        loading: true,
      };
    case "no-environments":
      return {
        title: "No environments connected",
        detail: detail.noEnvironments,
        loading: false,
      };
    case "unavailable":
      return {
        title: phase.reason === "unsupported" ? "Client not supported" : "Environment unavailable",
        detail:
          phase.error ??
          "The saved environment is offline. Check the URL or start the environment, then retry.",
        loading: false,
      };
    case "connecting":
    case "connected":
      return {
        title: "Connecting to environment",
        detail: detail.connecting,
        loading: true,
      };
  }
}

export function resolveHomeEmptyState(input: {
  readonly phase: WorkspacePhase;
  readonly projectCount: number;
}): WorkspaceEmptyState {
  return (
    resolveMissingShellEmptyState(input.phase, {
      noEnvironments: "Add an environment to load projects and start coding sessions.",
      connecting: "Loading projects and threads from the saved environment.",
    }) ??
    (input.projectCount === 0
      ? NO_PROJECTS
      : {
          title: "No threads yet",
          detail: "Create a task to start a new coding runtime in one of your connected projects.",
          loading: false,
        })
  );
}

export function resolveNewTaskProjectEmptyState(phase: WorkspacePhase): WorkspaceEmptyState {
  return (
    resolveMissingShellEmptyState(phase, {
      noEnvironments: "Add an environment before creating a task.",
      connecting: "Loading projects from the saved environment.",
    }) ?? NO_PROJECTS
  );
}
