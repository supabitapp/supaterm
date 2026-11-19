import { act, render as renderUi, type Screen } from "../../test/render";
import { EnvironmentId, ProjectId, ThreadId } from "@supaterm/contracts";
import { type ComponentProps } from "react";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";

const { fake } = vi.hoisted(() => ({
  fake: <
    F extends (...args: never[]) => unknown = { call(...args: Array<unknown>): unknown }["call"],
  >(
    initial?: F,
  ) => {
    const script = { queue: [] as Array<F>, fallback: initial };
    const target = {
      call: (...args: Parameters<F>) =>
        (script.queue.shift() ?? script.fallback)?.(...args) as ReturnType<F>,
    };
    const spy = vi.spyOn(target, "call");
    const scripted = Object.assign(spy, {
      implement: (next: F) => {
        script.fallback = next;
        return scripted;
      },
      implementOnce: (next: F) => {
        script.queue.push(next);
        return scripted;
      },
      reset: (next?: F) => {
        script.queue = [];
        script.fallback = next ?? initial;
        spy.mockClear();
        return scripted;
      },
    });
    return scripted;
  },
}));
const state = vi.hoisted(() => ({
  worktreePath: "/tmp/worktree" as string | null,
  showContextMenu: fake(),
  writeTextToClipboard: fake(),
}));

vi.mock(import("../localApi"), async (original) => ({
  ...(await original()),
  readLocalApi: (() => ({ contextMenu: { show: state.showContextMenu } })) as never,
}));
vi.mock(import("../hooks/useCopyToClipboard"), async (original) => ({
  ...(await original()),
  writeTextToClipboard: state.writeTextToClipboard as never,
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

let fixtureScreen: Screen;
let container: HTMLDivElement;

function toolbar(props: Partial<ComponentProps<typeof BranchToolbar>> = {}) {
  return (
    <BranchToolbar
      layout="panel"
      panelSection="workspace"
      environmentId={EnvironmentId.make("local")}
      threadId={ThreadId.make("thread")}
      projectId={ProjectId.make("project")}
      worktreePath={state.worktreePath}
      isServerThread
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
  await using _fixture = await setup();

  const onEnvironmentChange = vi.fn();
  await act(async () =>
    fixtureScreen.rerender(
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

async function setup() {
  state.worktreePath = "/tmp/worktree";
  state.showContextMenu.reset(async () => "copy-path");
  state.writeTextToClipboard.reset(async () => true);
  container = document.createElement("div");
  document.body.append(container);
  fixtureScreen = await renderUi(null, { container });

  const ownedScreen = fixtureScreen;
  return {
    async [Symbol.asyncDispose]() {
      await ownedScreen[Symbol.asyncDispose]();

      vi.unstubAllGlobals();
    },
  };
}
