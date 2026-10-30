import { act, useLayoutEffect, useReducer } from "react";
import { RegistryContext } from "@effect/atom-react";
import { createRoot, type Root } from "react-dom/client";
import { AsyncResult } from "effect/reactivity";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const harness = vi.hoisted(() => ({
  selection: {
    selectedThread: { environmentId: "environment-1", id: "thread-1" } as unknown,
    selectedThreadProject: { id: "project-1", workspaceRoot: "/repo" } as unknown,
    selectedEnvironmentRuntime: { connectionState: "connected" } as unknown,
  },
  worktree: { selectedThreadCwd: "/repo" as string | null, selectedThreadWorktreePath: null },
  refreshStatusCalls: [] as Array<unknown>,
  renderCount: 0,

  onRefreshSettled: () => {},
}));

vi.mock("./use-atom-command", () => ({
  useAtomCommand: () => async () => AsyncResult.success({}),
}));
vi.mock("./vcs", () => ({
  vcsEnvironment: {
    refreshStatus: {
      label: "refreshStatus",
      run: async (_registry: unknown, input: unknown) => {
        harness.refreshStatusCalls.push(input);
        harness.onRefreshSettled();
        return AsyncResult.success({});
      },
    },
  },
  vcsActionManager: { runStackedAction: () => "runStackedAction", track: vi.fn() },
}));
vi.mock("./threads", () => ({ threadEnvironment: { updateMetadata: "updateMetadata" } }));
vi.mock("./queries", () => ({ useBranches: () => ({ data: null, refresh: () => {} }) }));
vi.mock("../lib/uuid", () => ({ uuidv4: () => "uuid" }));
vi.mock("./atom-registry", async () => {
  const { AtomRegistry } = await import("effect/reactivity");
  return { appAtomRegistry: AtomRegistry.make() };
});
vi.mock("./session", () => ({
  readEnvironmentScope: () => true,
  useEnvironmentScope: () => true,
}));
vi.mock("./use-remote-environment-registry", async () => {
  const { Atom } = await import("effect/reactivity");
  return {
    environmentConnectedAtom: Atom.family(() => Atom.make(true)),
    setPendingConnectionError: () => {},
  };
});
vi.mock("./use-vcs-action-state", () => ({ showGitActionResult: () => {} }));

vi.mock("./use-thread-selection", () => ({
  useThreadSelection: () => {
    harness.renderCount += 1;
    if (harness.renderCount > 50) {
      throw new Error("Consumer rerendered more than 50 times");
    }
    return harness.selection;
  },
}));
vi.mock("./use-selected-thread-worktree", () => ({
  useSelectedThreadWorktree: () => harness.worktree,
}));

import { appAtomRegistry } from "./atom-registry";
import { useSelectedThreadGitActions } from "./use-selected-thread-git-actions";

let root: Root | null = null;
let rerender: () => void = () => {};

function Consumer() {
  const [, bump] = useReducer((count: number) => count + 1, 0);
  useLayoutEffect(() => {
    rerender = bump;
  });
  useSelectedThreadGitActions();
  return null;
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  harness.selection = {
    selectedThread: { environmentId: "environment-1", id: "thread-1" },
    selectedThreadProject: { id: "project-1", workspaceRoot: "/repo" },
    selectedEnvironmentRuntime: { connectionState: "connected" },
  };
  harness.worktree = { selectedThreadCwd: "/repo", selectedThreadWorktreePath: null };
  harness.refreshStatusCalls = [];
  harness.renderCount = 0;
  harness.onRefreshSettled = () => rerender();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

describe("useSelectedThreadGitActions", () => {
  it("refreshes once on mount and does not loop when refreshes rerender the consumer", async () => {
    root = createRoot(document.createElement("div"));
    await act(async () =>
      root!.render(
        <RegistryContext.Provider value={appAtomRegistry}>
          <Consumer />
        </RegistryContext.Provider>,
      ),
    );

    harness.selection = {
      selectedThread: { environmentId: "environment-1", id: "thread-1" },
      selectedThreadProject: { id: "project-1", workspaceRoot: "/repo" },
      selectedEnvironmentRuntime: { connectionState: "connected" },
    };
    await act(async () => rerender());

    expect(harness.refreshStatusCalls).toEqual([
      { environmentId: "environment-1", input: { cwd: "/repo" } },
    ]);
  });
});
