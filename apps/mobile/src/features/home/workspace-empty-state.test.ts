import { EnvironmentId } from "@supaterm/contracts";
import { describe, expect, it } from "vite-plus/test";

import { projectWorkspaceState, type WorkspaceEnvironment } from "../../state/workspaceModel";
import { resolveHomeEmptyState, resolveNewTaskProjectEmptyState } from "./workspace-empty-state";

function environment(
  connectionState: WorkspaceEnvironment["connectionState"],
  connectionError: string | null = null,
): WorkspaceEnvironment {
  return {
    environmentId: EnvironmentId.make("environment-1"),
    environmentLabel: "Sleeping laptop",
    displayUrl: "",
    isEnabled: true,
    connectionState,
    connectionError,
    connectionErrorTraceId: null,
  };
}

function phase(input: {
  readonly environment: WorkspaceEnvironment;
  readonly hasSnapshot?: boolean;
  readonly synchronizing?: boolean;
}) {
  const synchronizing = input.synchronizing ?? false;
  return projectWorkspaceState({
    isReady: true,
    networkStatus: "online",
    environments: [input.environment],
    shellSummary: {
      hasSnapshot: input.hasSnapshot ?? false,
      hasSynchronizingShell: synchronizing,
      firstError: null,
    },
    hasSyncingConnectedEnvironment:
      synchronizing && input.environment.connectionState === "connected",
  }).phase;
}

const connecting = phase({ environment: environment("connecting"), synchronizing: true });

describe("workspace empty state", () => {
  it.each([
    [
      "an environment keeps failing to reconnect",
      phase({ environment: environment("reconnecting", "Could not reach Sleeping laptop") }),
    ],
    [
      "a connected environment loads its first shell snapshot",
      phase({ environment: environment("connected"), synchronizing: true }),
    ],
    [
      "a connected environment retries its first shell snapshot",
      phase({ environment: environment("connected") }),
    ],
  ])("keeps the connecting presentation while %s", (_name, current) => {
    const home = resolveHomeEmptyState({ phase: current, projectCount: 0 });
    const newTask = resolveNewTaskProjectEmptyState(current);

    expect(home).toEqual(resolveHomeEmptyState({ phase: connecting, projectCount: 0 }));
    expect(home.loading).toBe(true);
    expect(newTask).toEqual(resolveNewTaskProjectEmptyState(connecting));
    expect(newTask.loading).toBe(true);
  });

  it("describes the cached shell instead of the connection once a snapshot exists", () => {
    const cached = phase({
      environment: environment("reconnecting", "Could not reach Sleeping laptop"),
      hasSnapshot: true,
    });
    const home = resolveHomeEmptyState({ phase: cached, projectCount: 0 });

    expect(home.loading).toBe(false);
    expect(home).toEqual(resolveNewTaskProjectEmptyState(cached));
    expect(resolveHomeEmptyState({ phase: cached, projectCount: 1 })).not.toEqual(home);
  });
});
