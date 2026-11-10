import type { WorkspacePhase, WorkspaceShell, WorkspaceState } from "../../state/workspaceModel";

export interface WorkspaceConnectionStatusPresentation {
  readonly label: string;
}

const OFFLINE_LABEL = "You are offline";

function shellSyncLabel(shell: WorkspaceShell): string | null {
  switch (shell) {
    case "loading":
      return "Loading threads...";
    case "syncing":
      return "Syncing threads...";
    case "none":
    case "loaded":
      return null;
  }
}

function workspaceConnectionStatusLabel(phase: WorkspacePhase): string | null {
  switch (phase.type) {
    case "loading-catalog":
    case "no-environments":
      return phase.offline ? OFFLINE_LABEL : null;
    case "unavailable":
      if (phase.reason === "offline") return OFFLINE_LABEL;
      return (
        phase.error ??
        shellSyncLabel(phase.shell) ??
        (phase.shell === "loaded" ? "Not connected" : null)
      );
    case "connecting": {
      const [environment, ...others] = phase.environments;
      return others.length === 0
        ? `Reconnecting to ${environment.environmentLabel}`
        : `Reconnecting ${phase.environments.length} environments`;
    }
    case "connected":
      return shellSyncLabel(phase.shell);
  }
}

export function workspaceConnectionStatusPresentation(
  state: WorkspaceState,
): WorkspaceConnectionStatusPresentation | null {
  const label = workspaceConnectionStatusLabel(state.phase);
  return label === null ? null : { label };
}
