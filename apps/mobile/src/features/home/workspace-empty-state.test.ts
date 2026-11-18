import { EnvironmentId } from "@supaterm/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  projectWorkspaceState,
  type WorkspaceEnvironment,
  type WorkspaceState,
} from "../../state/workspaceModel";
import { resolveHomeEmptyState, resolveNewTaskProjectEmptyState } from "./workspace-empty-state";

const RETAINED_FAILURE = "Could not reach Sleeping laptop";

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

function workspace(input: {
  readonly environments: ReadonlyArray<WorkspaceEnvironment>;
  readonly hasSnapshot?: boolean;
  readonly synchronizing?: boolean;
  readonly offline?: boolean;
}) {
  const synchronizing = input.synchronizing ?? false;
  return projectWorkspaceState({
    isReady: true,
    networkStatus: input.offline ? "offline" : "online",
    environments: input.environments,
    shellSummary: {
      hasSnapshot: input.hasSnapshot ?? false,
      hasSynchronizingShell: synchronizing,
      firstError: null,
    },
    hasSyncingConnectedEnvironment:
      synchronizing &&
      input.environments.some((environment) => environment.connectionState === "connected"),
  });
}

function home(state: WorkspaceState, projectCount: number) {
  return resolveHomeEmptyState({
    phase: state.phase,
    catalogPending: state.catalogPending,
    projectCount,
  });
}

const failing = environment("reconnecting", RETAINED_FAILURE);
const connecting = workspace({ environments: [environment("connecting")], synchronizing: true });

describe("workspace empty state", () => {
  it.each([
    [
      "waits while a saved environment retries after a retained failure",
      workspace({ environments: [failing] }),
      1,
      { title: "Connecting to environment", loading: true, showsAddEnvironment: false },
    ],
    [
      "waits for a connected environment's first shell snapshot",
      workspace({ environments: [environment("connected")], synchronizing: true }),
      0,
      { title: "Loading threads", loading: true, showsAddEnvironment: false },
    ],
    [
      "waits while a connected environment retries its first shell snapshot",
      workspace({ environments: [environment("connected")] }),
      0,
      { title: "Loading threads", loading: true, showsAddEnvironment: false },
    ],
    [
      "waits while another environment is still connecting after one loaded empty",
      workspace({ environments: [environment("connected"), failing], hasSnapshot: true }),
      0,
      { title: "Loading threads", loading: true, showsAddEnvironment: false },
    ],
    [
      "waits while a cached environment retries after a retained failure",
      workspace({ environments: [failing], hasSnapshot: true }),
      0,
      { title: "Connecting to environment", loading: true, showsAddEnvironment: false },
    ],
    [
      "reports no threads once every environment has resolved",
      workspace({ environments: [environment("connected")], hasSnapshot: true }),
      1,
      { title: "No threads yet", loading: false, showsAddEnvironment: false },
    ],
    [
      "does not wait on retries while the device is offline",
      workspace({ environments: [failing], hasSnapshot: true, offline: true }),
      1,
      { title: "No threads yet", loading: false, showsAddEnvironment: true },
    ],
  ] as const)("Home %s", (_name, state, projectCount, expected) => {
    const { title, loading, showsAddEnvironment } = home(state, projectCount);
    expect({ title, loading, showsAddEnvironment }).toEqual(expected);
  });

  it.each([
    ["an environment keeps failing to reconnect", workspace({ environments: [failing] })],
    [
      "a connected environment loads its first shell snapshot",
      workspace({ environments: [environment("connected")], synchronizing: true }),
    ],
    [
      "a connected environment retries its first shell snapshot",
      workspace({ environments: [environment("connected")] }),
    ],
  ])("New Task keeps the connecting presentation while %s", (_name, current) => {
    const newTask = resolveNewTaskProjectEmptyState(current.phase);

    expect(newTask).toEqual(resolveNewTaskProjectEmptyState(connecting.phase));
    expect(newTask.loading).toBe(true);
  });

  it("describes the cached shell instead of the connection once nothing is pending", () => {
    const cached = workspace({
      environments: [environment("error", RETAINED_FAILURE)],
      hasSnapshot: true,
    });
    const { showsAddEnvironment, ...empty } = home(cached, 0);

    expect(empty.loading).toBe(false);
    expect(showsAddEnvironment).toBe(true);
    expect(empty).toEqual(resolveNewTaskProjectEmptyState(cached.phase));
    expect(home(cached, 1).title).not.toBe(empty.title);
  });
});
