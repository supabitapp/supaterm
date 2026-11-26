import { msg } from "gt-react-native";

import { m, type MessageResolver } from "../../i18n/messages";
import { workspaceHasShellSnapshot, type WorkspacePhase } from "../../state/workspaceModel";

interface WorkspaceEmptyState {
  readonly title: string;
  readonly detail: string;
  readonly loading: boolean;
}

interface HomeEmptyState extends WorkspaceEmptyState {
  readonly showsAddEnvironment: boolean;
}

const HOME_CONNECTING: WorkspaceEmptyState = {
  title: msg("Connecting to environment"),
  detail: msg("Loading projects and threads from the saved environment."),
  loading: true,
};

const NO_THREADS: WorkspaceEmptyState = {
  title: msg("No threads yet"),
  detail: msg("Create a task to start a new coding runtime in one of your connected projects."),
  loading: false,
};

const NO_PROJECTS: WorkspaceEmptyState = {
  title: msg("No projects found"),
  detail: msg("The connected environment did not report any projects."),
  loading: false,
};

function resolved(state: WorkspaceEmptyState, resolve: MessageResolver): WorkspaceEmptyState {
  return { ...state, title: resolve(state.title), detail: resolve(state.detail) };
}

function resolveMissingShellEmptyState(
  phase: WorkspacePhase,
  detail: { readonly noEnvironments: string; readonly connecting: string },
  resolve: MessageResolver,
): WorkspaceEmptyState | null {
  if (workspaceHasShellSnapshot(phase)) {
    return null;
  }
  switch (phase.type) {
    case "loading-catalog":
      return {
        title: resolve(msg("Loading environments")),
        detail: resolve(msg("Checking saved environments on this device.")),
        loading: true,
      };
    case "no-environments":
      return {
        title: resolve(msg("No environments connected")),
        detail: detail.noEnvironments,
        loading: false,
      };
    case "unavailable":
      return {
        title:
          phase.reason === "unsupported"
            ? resolve(msg("Client not supported"))
            : resolve(msg("Environment unavailable")),
        detail:
          phase.error ??
          resolve(
            msg(
              "The saved environment is offline. Check the URL or start the environment, then retry.",
            ),
          ),
        loading: false,
      };
    case "connecting":
    case "connected":
      return {
        title: resolve(msg("Connecting to environment")),
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

function resolveHomeContent(
  input: HomeEmptyStateInput,
  resolve: MessageResolver,
): WorkspaceEmptyState {
  const missingShell = resolveMissingShellEmptyState(
    input.phase,
    {
      noEnvironments: resolve(
        msg("Add an environment to load projects and start coding sessions."),
      ),
      connecting: resolve(HOME_CONNECTING.detail),
    },
    resolve,
  );
  if (missingShell !== null) return missingShell;
  if (input.catalogPending) return resolved(HOME_CONNECTING, resolve);
  return resolved(input.projectCount === 0 ? NO_PROJECTS : NO_THREADS, resolve);
}

export function resolveHomeEmptyState(
  input: HomeEmptyStateInput,
  resolve: MessageResolver = m,
): HomeEmptyState {
  const content = resolveHomeContent(input, resolve);
  const state =
    content.loading && input.phase.type === "connected"
      ? { ...content, title: resolve(msg("Loading threads")) }
      : content;
  return { ...state, showsAddEnvironment: !state.loading && input.phase.type !== "connected" };
}

export function resolveNewTaskProjectEmptyState(
  phase: WorkspacePhase,
  resolve: MessageResolver = m,
): WorkspaceEmptyState {
  return (
    resolveMissingShellEmptyState(
      phase,
      {
        noEnvironments: resolve(msg("Add an environment before creating a task.")),
        connecting: resolve(msg("Loading projects from the saved environment.")),
      },
      resolve,
    ) ?? resolved(NO_PROJECTS, resolve)
  );
}
