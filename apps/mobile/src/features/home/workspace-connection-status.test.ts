import { EnvironmentId } from "@supaterm/contracts";
import { describe, expect, it } from "vite-plus/test";

import { projectWorkspaceState, type WorkspaceEnvironment } from "../../state/workspaceModel";
import { workspaceConnectionStatusPresentation } from "./workspace-connection-status";

function environment(
  environmentLabel: string,
  connectionState: WorkspaceEnvironment["connectionState"],
  connectionError: string | null = null,
): WorkspaceEnvironment {
  return {
    environmentId: EnvironmentId.make(environmentLabel),
    environmentLabel,
    displayUrl: "",
    isEnabled: true,
    connectionState,
    connectionError,
    connectionErrorTraceId: null,
  };
}

const NO_SHELL = { hasSnapshot: false, hasSynchronizingShell: false, firstError: null };
const LOADING_SHELL = { ...NO_SHELL, hasSynchronizingShell: true };
const SYNCING_SHELL = { ...LOADING_SHELL, hasSnapshot: true };

const desk = environment("Desk", "connected");
const unreachable = "Could not reach sleeping laptop";

function status(input: Partial<Parameters<typeof projectWorkspaceState>[0]>) {
  return workspaceConnectionStatusPresentation(
    projectWorkspaceState({
      isReady: true,
      networkStatus: "online",
      environments: [desk],
      shellSummary: SYNCING_SHELL,
      hasSyncingConnectedEnvironment: false,
      ...input,
    }),
  );
}

describe("workspace connection status", () => {
  it.each([
    ["connecting", null],
    ["reconnecting", null],
    ["connecting", unreachable],
    ["reconnecting", unreachable],
    ["error", unreachable],
  ] as const)(
    "keeps the brand while a secondary environment is %s (%s)",
    (connectionState, connectionError) => {
      expect(
        status({
          environments: [desk, environment("Sleeping laptop", connectionState, connectionError)],
        }),
      ).toBeNull();
    },
  );

  it.each([
    [
      "connected shell catch-up even while a secondary environment is unreachable",
      {
        environments: [desk, environment("Sleeping laptop", "reconnecting", unreachable)],
        hasSyncingConnectedEnvironment: true,
      },
      "Syncing threads...",
    ],
    [
      "the first shell load of a connected environment",
      { shellSummary: LOADING_SHELL, hasSyncingConnectedEnvironment: true },
      "Loading threads...",
    ],
    [
      "the environment that keeps failing to reconnect",
      {
        environments: [environment("Sleeping laptop", "reconnecting", unreachable)],
        shellSummary: NO_SHELL,
      },
      "Reconnecting to Sleeping laptop",
    ],
    [
      "an offline device before any environment is saved",
      { networkStatus: "offline", environments: [], shellSummary: NO_SHELL },
      "You are offline",
    ],
  ] as const)("shows %s", (_name, input, label) => {
    expect(status(input)).toEqual({ label });
  });
});
