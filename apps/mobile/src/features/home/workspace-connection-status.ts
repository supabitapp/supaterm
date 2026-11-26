import type {
  WorkspacePhase,
  WorkspaceShellStatus,
  WorkspaceState,
} from "../../state/workspaceModel";
import { msg } from "gt-react-native";

import { m, type MessageResolver } from "../../i18n/messages";

export interface WorkspaceConnectionStatusPresentation {
  readonly label: string;
}

function shellSyncLabel(shell: WorkspaceShellStatus, resolve: MessageResolver): string | null {
  switch (shell) {
    case "loading":
      return resolve(msg("Loading threads..."));
    case "syncing":
      return resolve(msg("Syncing threads..."));
    case "none":
    case "loaded":
      return null;
  }
}

function workspaceConnectionStatusLabel(
  phase: WorkspacePhase,
  resolve: MessageResolver,
): string | null {
  switch (phase.type) {
    case "loading-catalog":
    case "no-environments":
      return phase.offline ? resolve(msg("You are offline")) : null;
    case "unavailable":
      if (phase.reason === "offline") return resolve(msg("You are offline"));
      return (
        phase.error ??
        shellSyncLabel(phase.shell, resolve) ??
        (phase.shell === "loaded" ? resolve(msg("Not connected")) : null)
      );
    case "connecting": {
      const [environment, ...others] = phase.environments;
      return others.length === 0
        ? resolve(
            msg("Reconnecting to {environment}", {
              environment: environment.environmentLabel,
            }),
          )
        : resolve(
            msg(
              "{count, plural, one {Reconnecting {count} environment} other {Reconnecting {count} environments}}",
              { count: phase.environments.length },
            ),
          );
    }
    case "connected":
      return shellSyncLabel(phase.shell, resolve);
  }
}

export function workspaceConnectionStatusPresentation(
  state: WorkspaceState,
  resolve: MessageResolver = m,
): WorkspaceConnectionStatusPresentation | null {
  const label = workspaceConnectionStatusLabel(state.phase, resolve);
  return label === null ? null : { label };
}
