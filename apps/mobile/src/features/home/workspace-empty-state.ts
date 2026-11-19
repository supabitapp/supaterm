import { workspaceHasShellSnapshot, type WorkspacePhase } from "../../state/workspaceModel";

interface WorkspaceEmptyState {
  readonly title: string;
  readonly detail: string;
  readonly loading: boolean;
}

const HOME_CONNECTING: WorkspaceEmptyState = {
  title: "Connecting to environment",
  detail: "Loading projects and threads from the saved environment.",
  loading: true,
};

const NO_THREADS: WorkspaceEmptyState = {
  title: "No threads yet",
  detail: "Create a task to start a new coding runtime in one of your connected projects.",
  loading: false,
};

const NO_PROJECTS: WorkspaceEmptyState = {
  title: "No projects found",
  detail: "The connected environment did not report any projects.",
  loading: false,
};

function resolveMissingShellEmptyState(
  phase: WorkspacePhase,
  detail: { readonly noEnvironments: string; readonly connecting: string },
) {
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

interface HomeEmptyStateInput {
  readonly phase: WorkspacePhase;
  readonly catalogPending: boolean;
  readonly projectCount: number;
}

function resolveHomeContent(input: HomeEmptyStateInput) {
  const missingShell = resolveMissingShellEmptyState(input.phase, {
    noEnvironments: "Add an environment to load projects and start coding sessions.",
    connecting: HOME_CONNECTING.detail,
  });
  if (missingShell !== null) return missingShell;
  if (input.catalogPending) return HOME_CONNECTING;
  return input.projectCount === 0 ? NO_PROJECTS : NO_THREADS;
}

export function resolveHomeEmptyState(input: HomeEmptyStateInput) {
  const content = resolveHomeContent(input);
  const state =
    content.loading && input.phase.type === "connected"
      ? { ...content, title: "Loading threads" }
      : content;
  return { ...state, showsAddEnvironment: !state.loading && input.phase.type !== "connected" };
}

export function resolveNewTaskProjectEmptyState(phase: WorkspacePhase) {
  return (
    resolveMissingShellEmptyState(phase, {
      noEnvironments: "Add an environment before creating a task.",
      connecting: "Loading projects from the saved environment.",
    }) ?? NO_PROJECTS
  );
}
