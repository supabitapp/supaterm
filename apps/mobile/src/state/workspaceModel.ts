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

export type WorkspaceShellStatus = "none" | "loading" | "loaded" | "syncing";

export type WorkspacePhase =
  | { readonly type: "loading-catalog"; readonly offline: boolean }
  | { readonly type: "no-environments"; readonly offline: boolean }
  | {
      readonly type: "unavailable";
      readonly reason: "offline" | "unsupported" | "disconnected";
      readonly error: string | null;
      readonly shell: WorkspaceShellStatus;
    }
  | {
      readonly type: "connecting";
      readonly environments: readonly [WorkspaceEnvironment, ...WorkspaceEnvironment[]];
      readonly shell: WorkspaceShellStatus;
    }
  | { readonly type: "connected"; readonly shell: WorkspaceShellStatus };

export interface WorkspaceState extends Pick<
  WorkspaceConnectionState,
  "hasConnections" | "connectionState"
> {
  readonly phase: WorkspacePhase;
  /** Projects may still arrive: the catalog, a first snapshot, or an unfailed connection is pending. */
  readonly awaitingProjects: boolean;
  /** No snapshot is on its way. An environment that keeps failing to reconnect counts as settled. */
  readonly shellsSettled: boolean;
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

function workspaceShell(hasSnapshot: boolean, synchronizing: boolean): WorkspaceShellStatus {
  if (hasSnapshot) {
    return synchronizing ? "syncing" : "loaded";
  }
  return synchronizing ? "loading" : "none";
}

function resolveWorkspacePhase(
  input: WorkspaceInput,
  connection: WorkspaceConnectionState,
  [connecting, ...alsoConnecting]: ReadonlyArray<WorkspaceEnvironment>,
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
  if (!offline && connecting !== undefined) {
    return { type: "connecting", environments: [connecting, ...alsoConnecting], shell };
  }

  return {
    type: "unavailable",
    reason: offline
      ? "offline"
      : connection.connectionState === "unsupported"
        ? "unsupported"
        : "disconnected",
    error: connection.connectionError,
    shell,
  };
}

export function projectWorkspaceState(input: WorkspaceInput): WorkspaceState {
  const connection = projectWorkspaceConnectionState(input);
  const connecting = input.environments.filter(
    (environment) =>
      environment.isEnabled &&
      (environment.connectionState === "connecting" ||
        environment.connectionState === "reconnecting"),
  );
  const phase = resolveWorkspacePhase(input, connection, connecting);
  return {
    hasConnections: connection.hasConnections,
    connectionState: connection.connectionState,
    phase,
    awaitingProjects:
      !input.isReady ||
      (!input.shellSummary.hasSnapshot &&
        ((connecting.length > 0 && connection.connectionError === null) ||
          (phase.type === "connected" && phase.shell === "loading"))),
    shellsSettled:
      input.isReady &&
      !input.shellSummary.hasSynchronizingShell &&
      !connecting.some(
        (environment) =>
          environment.connectionState === "connecting" || environment.connectionError === null,
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

export type ServerConfigByEnvironmentId = ReadonlyMap<EnvironmentId, ServerConfig>;
