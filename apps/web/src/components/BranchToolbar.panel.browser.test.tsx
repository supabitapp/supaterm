import { EnvironmentId, ProjectId, ThreadId } from "@supaterm/contracts";
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";

const state = vi.hoisted(() => ({
  worktreePath: "/tmp/worktree" as string | null,
  showContextMenu: vi.fn(),
  writeTextToClipboard: vi.fn(),
}));

vi.mock(import("../localApi"), async (original) => ({
  ...(await original()),
  readLocalApi: (() => ({ contextMenu: { show: state.showContextMenu } })) as never,
}));
vi.mock(import("../hooks/useCopyToClipboard"), async (original) => ({
  ...(await original()),
  writeTextToClipboard: state.writeTextToClipboard,
}));
vi.mock(import("./BranchToolbarBranchSelector"), async (original) => ({
  ...(await original()),
  BranchToolbarBranchSelector: (() => null) as never,
}));
vi.mock(import("../state/entities"), async (original) => ({
  ...(await original()),
  useQuietThreadShell: (() => ({
    environmentId: "local",
    projectId: "project",
    worktreePath: state.worktreePath,
  })) as never,
  useProject: (() => ({ workspaceRoot: "/tmp/project" })) as never,
  useThreadShellsForProjectRefs: () => [],
}));

import { BranchToolbar } from "./BranchToolbar";
import { BranchToolbarEnvironmentSelector } from "./BranchToolbarEnvironmentSelector";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.worktreePath = "/tmp/worktree";
  state.showContextMenu.mockReset().mockResolvedValue("copy-path");
  state.writeTextToClipboard.mockReset().mockResolvedValue(true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function toolbar(props: Partial<ComponentProps<typeof BranchToolbar>> = {}) {
  return (
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
      {...props}
    />
  );
}

it("keeps the machine picker usable beside a locked workspace", async () => {
  const onEnvironmentChange = vi.fn();
  await act(async () =>
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
        {toolbar()}
      </>,
    ),
  );
  const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Run on"]')!;
  expect(trigger.textContent).toBe("local");
  expect(container.querySelectorAll("button")).toHaveLength(1);

  await userEvent.click(trigger);
  await userEvent.click(page.getByRole("option", { name: "remote" }));
  expect(onEnvironmentChange).toHaveBeenCalledWith("remote");
});

it.each([
  ["local", null, "/tmp/project"],
  ["worktree", null, null],
  ["worktree", "/tmp/worktree", "/tmp/worktree"],
] as const)(
  "copies only an existing workspace path with mode %s and worktree %s",
  async (envMode, worktreePath, copiedPath) => {
    state.worktreePath = worktreePath;
    await act(async () => root.render(toolbar({ envMode })));
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    await act(async () => {
      container.querySelector("[data-composer-context-control]")!.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(copiedPath !== null);
    if (copiedPath === null) {
      expect(state.showContextMenu).not.toHaveBeenCalled();
      expect(state.writeTextToClipboard).not.toHaveBeenCalled();
    } else {
      await vi.waitFor(() =>
        expect(state.writeTextToClipboard).toHaveBeenCalledWith(copiedPath, "workspace path"),
      );
    }
  },
);
