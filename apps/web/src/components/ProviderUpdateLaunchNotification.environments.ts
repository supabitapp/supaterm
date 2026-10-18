import type { ConnectionCatalogEntry } from "@supaterm/client-runtime/connection";
import type { ServerConfig } from "@supaterm/contracts";

import { useEnvironments, usePrimaryEnvironmentId } from "~/state/environments";
import { isDesktopLocalConnectionTarget } from "~/connection/desktopLocal";
import {
  buildLocalEnvironmentUpdateGroups,
  deriveEnvironmentDisplayLabel,
  type EnvironmentUpdateConnectionState,
  type LocalEnvironmentProvidersInput,
  type LocalEnvironmentUpdateGroup,
} from "./ProviderUpdateLaunchNotification.logic";

/**
 * A local environment is either the same-origin primary backend or a
 * desktop-local secondary (the parallel WSL backend), which connects over
 * loopback with a bearer token and carries a `local:<backendInstanceId>`
 * connection id. SSH and other remote targets are excluded.
 */
function isLocalConnectionTarget(target: ConnectionCatalogEntry["target"]): boolean {
  return target._tag === "PrimaryConnectionTarget" || isDesktopLocalConnectionTarget(target);
}

function normalizeConnectionState(phase: string | undefined): EnvironmentUpdateConnectionState {
  switch (phase) {
    case "connected":
      return "ready";
    case "connecting":
    case "reconnecting":
      return "connecting";
    case "unsupported":
    case "error":
      return "error";
    case "offline":
      return "disconnected";
    default:
      return "connecting";
  }
}

export function useLocalEnvironmentUpdateGroups(): {
  readonly groups: LocalEnvironmentUpdateGroup[];
  readonly isAnySettling: boolean;
} {
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();

  const inputs: LocalEnvironmentProvidersInput[] = [];

  for (const environment of environments) {
    if (!isLocalConnectionTarget(environment.entry.target)) {
      continue;
    }

    const isPrimary = environment.environmentId === primaryEnvironmentId;
    const serverConfig: ServerConfig | null = environment.serverConfig;

    inputs.push({
      environmentId: environment.environmentId,
      label: isPrimary
        ? deriveEnvironmentDisplayLabel({
            isWsl: false,
            wslDistro: null,
            platformOs: serverConfig?.environment.platform.os,
            fallbackLabel: environment.label,
          })
        : environment.label,
      isPrimary,
      connectionState: isPrimary ? "ready" : normalizeConnectionState(environment.connection.phase),
      providers: serverConfig?.providers ?? [],
    });
  }

  inputs.sort((left, right) => Number(right.isPrimary) - Number(left.isPrimary));

  return buildLocalEnvironmentUpdateGroups(inputs);
}
