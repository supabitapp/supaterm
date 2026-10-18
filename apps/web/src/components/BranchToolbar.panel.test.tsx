// @vitest-environment jsdom

import { EnvironmentId, ProjectId, ThreadId } from "@supaterm/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  worktreePath: "/tmp/worktree" as string | null,
  showContextMenu: vi.fn().mockResolvedValue("copy-path"),
  writeTextToClipboard: vi.fn().mockResolvedValue(true),
}));

vi.mock("../localApi", () => ({
  readLocalApi: () => ({ contextMenu: { show: state.showContextMenu } }),
}));
vi.mock("../hooks/useCopyToClipboard", () => ({
  writeTextToClipboard: state.writeTextToClipboard,
}));
vi.mock("./BranchToolbarBranchSelector", () => ({ BranchToolbarBranchSelector: () => null }));
vi.mock("../composerDraftStore", () => ({
  useComposerDraftStore: (select: (store: unknown) => unknown) =>
    select({ getDraftThreadByRef: () => null, setDraftThreadContext: vi.fn() }),
}));
vi.mock("../state/entities", () => ({
  useQuietThreadShell: () => ({
    environmentId: "local",
    projectId: "project",
    worktreePath: state.worktreePath,
  }),
  useProject: () => ({ workspaceRoot: "/tmp/project" }),
  useThreadShellsForProjectRefs: () => [],
}));

import { BranchToolbar } from "./BranchToolbar";
import { BranchToolbarEnvironmentSelector } from "./BranchToolbarEnvironmentSelector";

it("keeps the machine picker usable beside a locked workspace", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onEnvironmentChange = vi.fn();
  try {
    await act(async () => {
      root.render(
        <>
          <BranchToolbarEnvironmentSelector
            displayMode="panel"
            environmentId={EnvironmentId.make("local")}
            envLocked={false}
            onEnvironmentChange={onEnvironmentChange}
            availableEnvironments={["local", "remote"].map((id) => ({
              environmentId: EnvironmentId.make(id),
              projectId: ProjectId.make("project"),
              label: id,
              isPrimary: id === "local",
              machine: "server",
            }))}
          />
          <BranchToolbar
            layout="panel"
            panelSection="workspace"
            environmentId={EnvironmentId.make("local")}
            threadId={ThreadId.make("thread")}
            showGitControls
            envMode="local"
            envLocked={false}
            startFromOrigin={false}
            onStartFromOriginChange={vi.fn()}
            onEnvModeChange={vi.fn()}
          />
        </>,
      );
    });
    const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Run on"]')!;
    expect(trigger.textContent).toBe("local");
    expect(container.querySelectorAll("button")).toHaveLength(1);
    await act(async () => trigger.click());
    const items = [...document.querySelectorAll<HTMLElement>('[role="option"]')];
    await act(async () => items.find((item) => item.textContent?.includes("remote"))!.click());
    expect(onEnvironmentChange).toHaveBeenCalledWith("remote");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

it.each([
  ["local", null, "/tmp/project"],
  ["worktree", null, null],
  ["worktree", "/tmp/worktree", "/tmp/worktree"],
] as const)(
  "copies only an existing workspace path with mode %s and worktree %s",
  async (envMode, worktreePath, copiedPath) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    state.worktreePath = worktreePath;
    state.showContextMenu.mockClear();
    state.writeTextToClipboard.mockClear();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(
          <BranchToolbar
            layout="panel"
            panelSection="workspace"
            environmentId={EnvironmentId.make("local")}
            threadId={ThreadId.make("thread")}
            showGitControls
            envMode={envMode}
            envLocked={false}
            startFromOrigin={false}
            onStartFromOriginChange={vi.fn()}
            onEnvModeChange={vi.fn()}
          />,
        );
      });
      const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
      await act(async () => {
        container.querySelector("[data-composer-context-control]")!.dispatchEvent(event);
      });
      expect(event.defaultPrevented).toBe(copiedPath !== null);
      if (copiedPath === null) {
        expect(state.showContextMenu).not.toHaveBeenCalled();
        expect(state.writeTextToClipboard).not.toHaveBeenCalled();
      } else {
        expect(state.writeTextToClipboard).toHaveBeenCalledWith(copiedPath, "workspace path");
      }
    } finally {
      await act(async () => root.unmount());
      container.remove();
      state.worktreePath = "/tmp/worktree";
      vi.unstubAllGlobals();
    }
  },
);
