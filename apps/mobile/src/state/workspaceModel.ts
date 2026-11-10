import { type EnvironmentShellSummary } from "@supaterm/client-runtime/state/shell";
import type { EnvironmentId, ServerConfig } from "@supaterm/contracts";

import {
  type EnvironmentConnectionPhase,
  type NetworkStatus,
} from "@supaterm/client-runtime/connection";

import type { EnvironmentConnectionSummary as WorkspaceEnvironment } from "@supaterm/client-runtime/state/presentation";

export type { EnvironmentConnectionSummary as WorkspaceEnvironment } from "@supaterm/client-runtime/state/presentation";

export interface WorkspaceConnectionState {
  readonly hasConnections: boolean;
  readonly hasReadyEnvironment: boolean;
  readonly connectionState: EnvironmentConnectionPhase;
  readonly connectionError: string | null;
}

export type WorkspaceShell = "none" | "loading" | "loaded" | "syncing";

export type WorkspacePhase =
  | { readonly type: "loading-catalog"; readonly offline: boolean }
  | { readonly type: "no-environments"; readonly offline: boolean }
  | {
      readonly type: "unavailable";
      readonly reason: "offline" | "unsupported" | "disconnected";
      readonly error: string | null;
      readonly shell: WorkspaceShell;
    }
  | {
      readonly type: "connecting";
      readonly environments: readonly [WorkspaceEnvironment, ...WorkspaceEnvironment[]];
      readonly error: string | null;
      readonly shell: WorkspaceShell;
    }
  | { readonly type: "connected"; readonly shell: WorkspaceShell };

export interface WorkspaceState extends Pick<
  WorkspaceConnectionState,
  "hasConnections" | "connectionState"
> {
  readonly phase: WorkspacePhase;
  /** An enabled environment is still trying to connect and none has failed, whatever the phase. */
  readonly environmentsPending: boolean;
}

interface WorkspaceConnectionInput {
  readonly isReady: boolean;
  readonly networkStatus: NetworkStatus;
  readonly environments: ReadonlyArray<WorkspaceEnvironment>;
}

interface WorkspaceInput extends WorkspaceConnectionInput {
  readonly shellSummary: EnvironmentShellSummary;
  readonly hasSyncingConnectedEnvironment: boolean;
}

function overallConnectionState(
  environments: ReadonlyArray<WorkspaceEnvironment>,
  networkStatus: NetworkStatus,
): EnvironmentConnectionPhase {
  if (environments.length === 0) {
    return "available";
  }
  if (networkStatus === "offline") {
    return "offline";
  }
  if (environments.some((environment) => environment.connectionState === "connected")) {
    return "connected";
  }
  if (environments.some((environment) => environment.connectionState === "reconnecting")) {
    return "reconnecting";
  }
  if (environments.some((environment) => environment.connectionState === "connecting")) {
    return "connecting";
  }
  if (environments.some((environment) => environment.connectionState === "unsupported")) {
    return "unsupported";
  }
  if (environments.some((environment) => environment.connectionState === "error")) {
    return "error";
  }
  if (environments.some((environment) => environment.connectionState === "offline")) {
    return "offline";
  }
  return "available";
}

export function projectWorkspaceConnectionState(
  input: WorkspaceConnectionInput,
): WorkspaceConnectionState {
  const activeEnvironments = input.environments.filter((environment) => environment.isEnabled);
  const connectionState = overallConnectionState(activeEnvironments, input.networkStatus);

  return {
    hasConnections: input.environments.length > 0,
    hasReadyEnvironment: connectionState === "connected",
    connectionState,
    connectionError:
      activeEnvironments.find((environment) => environment.connectionError !== null)
        ?.connectionError ?? null,
  };
}

function workspaceShell(hasSnapshot: boolean, synchronizing: boolean): WorkspaceShell {
  if (hasSnapshot) {
    return synchronizing ? "syncing" : "loaded";
  }
  return synchronizing ? "loading" : "none";
}

function resolveWorkspacePhase(
  input: WorkspaceInput,
  connection: WorkspaceConnectionState,
): WorkspacePhase {
  const offline = input.networkStatus === "offline";
  if (!input.isReady) {
    return { type: "loading-catalog", offline };
  }
  if (!connection.hasConnections) {
    return { type: "no-environments", offline };
  }

  const { hasSnapshot, hasSynchronizingShell } = input.shellSummary;
  if (connection.connectionState === "connected") {
    return {
      type: "connected",
      shell: workspaceShell(hasSnapshot, input.hasSyncingConnectedEnvironment),
    };
  }

  const shell = workspaceShell(hasSnapshot, hasSynchronizingShell);
  const error = connection.connectionError;
  const [connecting, ...alsoConnecting] = input.environments.filter(
    (environment) =>
      environment.isEnabled &&
      (environment.connectionState === "connecting" ||
        environment.connectionState === "reconnecting"),
  );
  if (!offline && connecting !== undefined) {
    return { type: "connecting", environments: [connecting, ...alsoConnecting], error, shell };
  }

  return {
    type: "unavailable",
    reason: offline
      ? "offline"
      : connection.connectionState === "unsupported"
        ? "unsupported"
        : "disconnected",
    error,
    shell,
  };
}

export function projectWorkspaceState(input: WorkspaceInput): WorkspaceState {
  const connection = projectWorkspaceConnectionState(input);
  return {
    hasConnections: connection.hasConnections,
    connectionState: connection.connectionState,
    phase: resolveWorkspacePhase(input, connection),
    environmentsPending:
      connection.connectionError === null &&
      input.environments.some(
        (environment) =>
          environment.isEnabled &&
          (environment.connectionState === "connecting" ||
            environment.connectionState === "reconnecting"),
      ),
  };
}

export function workspaceHasShellSnapshot(phase: WorkspacePhase): boolean {
  switch (phase.type) {
    case "loading-catalog":
    case "no-environments":
      return false;
    case "unavailable":
    case "connecting":
    case "connected":
      return phase.shell === "loaded" || phase.shell === "syncing";
  }
}

export function isAwaitingWorkspaceProjects(state: WorkspaceState): boolean {
  const { phase } = state;
  if (phase.type === "loading-catalog") return true;
  if (workspaceHasShellSnapshot(phase)) return false;
  return state.environmentsPending || (phase.type === "connected" && phase.shell === "loading");
}

export type ServerConfigByEnvironmentId = ReadonlyMap<EnvironmentId, ServerConfig>;
