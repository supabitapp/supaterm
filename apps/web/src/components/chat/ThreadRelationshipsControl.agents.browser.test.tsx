import { cloneElement, type ReactElement, type ReactNode } from "react";
import { scopedThreadKey } from "@supaterm/client-runtime/environment";
import { EnvironmentId, ThreadId, type ScopedThreadRef } from "@supaterm/contracts";
import * as DateTime from "effect/DateTime";
import { expect, it, vi } from "vite-plus/test";

import "~/index.css";

const state = vi.hoisted(() => ({
  stopWorkflowLabel: "environment-data:orchestration:stop-workflow",
  projection: null as unknown,
  projections: null as Map<string, unknown> | null,
  navigate: vi.fn(),
  shells: [] as unknown[],
  projects: [] as unknown[],
  configs: new Map<string, unknown>(),
  showTooltips: false,
  canOperateThread: true,
  command: vi.fn().mockResolvedValue({ _tag: "Success" }),
  workflowCommand: vi.fn().mockResolvedValue({ _tag: "Success" }),
  toast: vi.fn(),
}));

vi.mock(import("@tanstack/react-router"), async (original) => ({
  ...(await original()),
  useNavigate: (() => state.navigate) as never,
}));
vi.mock(import("../../state/entities"), async (original) => ({
  ...(await original()),
  useThreadProjection: ((ref: ScopedThreadRef | null) =>
    ref === null
      ? undefined
      : {
          projection: state.projections
            ? state.projections.get(scopedThreadKey(ref))
            : state.projection,
        }) as never,
  useThreadRelationshipShells: ((ref: { readonly environmentId: string }) =>
    (state.shells as ReadonlyArray<{ readonly environmentId: string; readonly source: unknown }>)
      .filter((shell) => shell.environmentId === ref.environmentId)
      .map((shell) => shell.source)) as never,
  useProjects: (() => state.projects) as never,
}));
vi.mock(import("../../state/environments"), async (original) => ({
  ...(await original()),
  useEnvironmentProviders: (() =>
    new Map(
      [...state.configs].map(([id, config]) => [id, (config as { providers: unknown }).providers]),
    )) as never,
}));
vi.mock(import("../../state/session"), async (original) => ({
  ...(await original()),
  useEnvironmentScope: (() => state.canOperateThread) as never,
  readEnvironmentScope: (() => state.canOperateThread) as never,
}));
vi.mock(import("../../lib/archivedThreadsState"), async (original) => ({
  ...(await original()),
  useArchivedThreadSnapshots: (() => ({ snapshots: [] })) as never,
}));
vi.mock(import("../../state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: ((command: { label?: string }) =>
    command.label === state.stopWorkflowLabel ? state.workflowCommand : state.command) as never,
}));
vi.mock(import("../ui/toast"), async (original) => {
  const actual = await original();
  return { ...actual, toastManager: { ...actual.toastManager, add: state.toast } as never };
});
vi.mock(import("../../state/orchestration"), async (original) => {
  const actual = await original();
  const { Atom } = await import("effect/reactivity");
  const granted = Atom.make(true);
  const stopWorkflow = actual.orchestrationEnvironment.stopWorkflow;
  return {
    ...actual,
    orchestrationEnvironment: Object.assign(Object.create(actual.orchestrationEnvironment), {
      stopWorkflow: Object.assign(Object.create(stopWorkflow), {
        label: state.stopWorkflowLabel,
        permissionAtom: () => granted,
      }),
    }),
  };
});
// Tooltip and hover card content renders inline so the suite can read every row's agent
// details across many states without hovering each row.
vi.mock(import("../ui/tooltip"), async () => {
  const { cloneElement } = await import("react");
  const passThrough = (({ children }: { children: ReactNode }) => children) as never;
  return {
    TooltipProvider: passThrough,
    TooltipScrollDismissArea: passThrough,
    TooltipShortcutLabel: passThrough,
    Tooltip: (({ children }: { children: ReactNode }) => children) as never,
    TooltipTrigger: (({ render, children }: { render: ReactElement; children: ReactNode }) =>
      cloneElement(render, {}, children)) as never,
    TooltipPopup: (({ children }: { children: ReactNode }) =>
      state.showTooltips ? <div role="tooltip">{children}</div> : null) as never,
  };
});

import { act, render as renderUi } from "../../../test/render";
import { ThreadRelationshipsPanel } from "./ThreadRelationshipsControl";

async function setup() {
  state.shells = [];
  state.projects = [];
  state.configs.clear();
  state.showTooltips = false;
  state.canOperateThread = true;
  state.navigate.mockClear();
  state.command.mockClear();
  state.workflowCommand.mockReset().mockResolvedValue({ _tag: "Success" });
  state.toast.mockClear();
  state.projection = null;
  state.projections = null;

  await using stack = new AsyncDisposableStack();
  const screen = stack.use(await renderUi(null));
  const container = screen.container;
  let current: ReactElement;

  async function render(element: ReactElement) {
    current = element;
    await act(async () => screen.rerender(element));
  }
  // The mocked hooks read `state` while rendering, so a new element picks up changes.
  const update = async () => await act(async () => screen.rerender(cloneElement(current)));
  const click = async (element: HTMLElement) => await act(async () => element.click());
  const buttons = () => [...container.querySelectorAll("button")];
  const allByLabel = (label: string) =>
    buttons().filter((button) => button.getAttribute("aria-label") === label);
  function byLabel(label: string) {
    const matches = allByLabel(label);
    if (matches.length !== 1)
      throw new Error(`Expected one "${label}" button, got ${matches.length}`);
    return matches[0]!;
  }
  const sectionToggles = (expanded: boolean) =>
    buttons().filter(
      (button) =>
        button.getAttribute("aria-expanded") === String(expanded) &&
        !button.hasAttribute("aria-label"),
    );
  function sectionToggle(expanded: boolean) {
    const [toggle] = sectionToggles(expanded);
    if (!toggle) throw new Error(`No ${expanded ? "expanded" : "collapsed"} section toggle`);
    return toggle;
  }
  const heading = () => container.querySelector("h3")?.textContent;
  const buttonsWithLabel = (matches: (label: string) => boolean) =>
    buttons().filter((button) => matches(button.getAttribute("aria-label") ?? ""));
  // Joins rendered text nodes; `visibleOnly` drops screen-reader-only text.
  function textNodes(separator: string, visibleOnly = false) {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const parts: string[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (visibleOnly && node.parentElement?.closest(".sr-only")) continue;
      parts.push(node.textContent ?? "");
    }
    return parts.join(separator);
  }

  const environment = stack.move();
  return {
    container,
    render,
    update,
    click,
    buttons,
    allByLabel,
    byLabel,
    sectionToggles,
    sectionToggle,
    heading,
    buttonsWithLabel,
    groupHeader: (label: string) =>
      buttons().find(
        (button) => button.hasAttribute("aria-controls") && button.textContent?.startsWith(label),
      ),
    textNodes,
    [Symbol.asyncDispose]: () => environment.disposeAsync(),
  };
}

it.each([
  { driver: "codex", origin: "app_owned", runId: null, canStop: true },
  { driver: "claudeAgent", origin: "app_owned", runId: null, canStop: true },
  { driver: "claudeAgent", origin: "provider_native", runId: "run-1", canStop: true },
  { driver: "claudeAgent", origin: "provider_native", runId: null, canStop: false },
])(
  "offers individual Stop for supported $origin $driver subagents with run $runId",
  async ({ driver, origin, runId, canStop }) => {
    await using fixture = await setup();
    const { render, update, click, allByLabel, byLabel } = fixture;
    const parent = {
      id: "parent",
      lineage: { relationshipToParent: null },
      activeProviderThreadId: null,
    };
    const child = {
      id: "child",
      title: "Worker",
      lineage: { parentThreadId: "parent", relationshipToParent: "subagent" },
    };
    const agent = {
      id: "agent",
      childThreadId: "child",
      origin,
      threadId: "parent",
      runId,
      nativeTaskRef: { driver, nativeId: "claude-task", strength: "strong" },
      driver,
      providerInstanceId: "codex",
      title: "Worker",
      prompt: "Check the change",
      model: "gpt-5.4",
      status: "running",
      progress: null,
      result: null,
      startedAt: DateTime.makeUnsafe("2026-09-16T12:00:00Z"),
      completedAt: null,
      updatedAt: DateTime.makeUnsafe("2026-09-16T12:00:00Z"),
    };
    state.shells = [{ environmentId: "test", source: child }];
    const projection = {
      thread: parent,
      runs: [],
      providerThreads: [],
      providerSessions: [],
      contextTransfers: [],
      subagents: [agent],
    };
    state.projection = projection;
    const panel = (
      <ThreadRelationshipsPanel
        environmentId={EnvironmentId.make("test")}
        threadId={ThreadId.make("parent")}
      />
    );
    await render(panel);
    if (!canStop) {
      expect(allByLabel("Stop subagent Worker")).toHaveLength(0);
      return;
    }
    const stopButton = () => byLabel("Stop subagent Worker");
    await click(stopButton());
    expect(state.command).toHaveBeenCalledWith({
      environmentId: "test",
      input: { threadId: "parent", subagentId: "agent" },
    });
    expect(state.navigate).not.toHaveBeenCalled();

    for (const status of ["starting", "running", "waiting"] as const) {
      state.command.mockClear();
      state.shells = [
        {
          environmentId: "test",
          source: {
            ...child,
            activityRunStatus: status,
            activityRunStartedAt: DateTime.makeUnsafe("2026-09-16T12:05:00Z"),
          },
        },
      ];
      state.projection = {
        ...projection,
        subagents: [{ ...agent, origin: "provider_native", status: "completed" }],
      };
      await update();
      expect(allByLabel("Stop subagent Worker")).toHaveLength(0);
      state.projection = { ...projection, subagents: [{ ...agent, status: "completed" }] };
      await update();
      if (origin === "provider_native") {
        expect(allByLabel("Stop subagent Worker")).toHaveLength(0);
        continue;
      }
      await click(stopButton());
      expect(state.command).toHaveBeenCalledTimes(1);
      expect(state.command).toHaveBeenLastCalledWith({
        environmentId: "test",
        input: { threadId: "parent", subagentId: "agent" },
      });
    }
    state.shells = [{ environmentId: "test", source: child }];
    for (const status of ["completed", "failed", "interrupted"]) {
      state.projection = { ...projection, subagents: [{ ...agent, status }] };
      await update();
      expect(allByLabel("Stop subagent Worker")).toHaveLength(0);
    }
    state.projection = { ...projection, subagents: [{ ...agent, startedAt: null }] };
    await update();
    expect(allByLabel("Stop subagent Worker")).toHaveLength(0);
    state.projection = {
      ...projection,
      subagents: [{ ...agent, origin: "provider_native", driver: "codex" }],
    };
    await update();
    expect(allByLabel("Stop subagent Worker")).toHaveLength(0);

    state.command.mockClear();
    state.canOperateThread = false;
    state.projection = { ...projection, subagents: [agent] };
    await update();
    expect(allByLabel("Stop subagent Worker")).toHaveLength(0);
    expect(state.command).not.toHaveBeenCalled();
  },
);

it("shows the matching child agent details and refreshes them when the agent settles", async () => {
  await using fixture = await setup();
  const { render, update, click, buttons, sectionToggles, sectionToggle, heading, textNodes } =
    fixture;
  const agent = {
    id: "agent-1",
    driver: "codex",
    providerInstanceId: "codex",
    childThreadId: "child-1",
    title: "Checker",
    prompt: "Check the change",
    model: "gpt-5.4",
    status: "running",
    progress: "Running checks",
    result: null,
    startedAt: DateTime.makeUnsafe("2026-09-16T12:00:00Z"),
    completedAt: null,
    updatedAt: DateTime.makeUnsafe("2026-09-16T12:00:00Z"),
  };
  const projection = {
    thread: {
      id: "parent",
      lineage: { relationshipToParent: null },
      activeProviderThreadId: null,
    },
    runs: [],
    providerThreads: [],
    providerSessions: [],
    contextTransfers: [],
    subagents: [
      { ...agent, id: "unlinked", childThreadId: null, title: "Unlinked agent" },
      agent,
      { ...agent, id: "agent-2", childThreadId: "child-2", title: "Worker", model: "gpt-5.3" },
    ],
  };
  state.projection = projection;
  const panel = (
    <ThreadRelationshipsPanel
      environmentId={EnvironmentId.make("test")}
      threadId={ThreadId.make("parent")}
    />
  );
  await render(panel);
  const text = () => textNodes(" ").replace(/\s+/g, " ");
  expect(text()).toContain("Checker");
  expect(text()).toContain("Subagents · 3 running");
  expect(text()).toContain("running");
  expect(text()).not.toContain("gpt-5.4");
  expect(text()).not.toContain("gpt-5.3");
  expect(text()).not.toContain("tok");
  expect(text()).not.toContain("Unlinked agent");
  expect(text()).not.toContain("Active agents");
  expect(sectionToggles(true)).toHaveLength(1);

  state.projection = {
    ...projection,
    subagents: [
      {
        ...agent,
        status: "completed",
        progress: undefined,
        result: "All checks passed",
        completedAt: DateTime.makeUnsafe("2026-09-16T12:02:15Z"),
      },
    ],
  };
  await update();
  expect(heading()).toBe("Related threads");
  expect(text()).toContain("Previous agents (1)");
  expect(text()).not.toContain("Checker");
  await click(sectionToggle(false));
  expect(text()).toContain("Checker");
  expect(text()).toContain("2m 15s");
  expect(text()).not.toContain("(1)");
  expect(text()).not.toContain("running");
  expect(text()).not.toContain("Worker");
  await click(sectionToggle(true));
  await vi.waitFor(() => expect(text()).not.toContain("Checker"));
  expect(text()).toContain("Previous agents (1)");
  await click(sectionToggle(false));
  expect(text()).toContain("Checker");

  state.projection = {
    ...projection,
    subagents: Array.from({ length: 8 }, (_, index) => ({
      ...agent,
      id: `running-agent-${index}`,
      childThreadId: `running-child-${index}`,
    })),
  };
  await update();
  expect(text()).toContain("Subagents · 8 running");

  state.projection = {
    ...projection,
    subagents: Array.from({ length: 8 }, (_, index) => ({
      ...agent,
      id: `old-agent-${index}`,
      childThreadId: `old-child-${index}`,
      status: index === 7 ? "failed" : "completed",
      title: `Old agent ${index}`,
      result: index === 7 ? "Earlier build failed" : "Done",
      completedAt: DateTime.makeUnsafe("2026-09-16T12:02:15Z"),
    })),
  };
  await update();
  expect(text()).toContain("1 failed");
  expect(text()).not.toContain("Old agent 7");
  await click(buttons().find((button) => button.textContent?.startsWith("Show "))!);
  expect(text()).toContain("Old agent 7");

  state.projection = {
    ...projection,
    subagents: [{ ...agent, childThreadId: null }],
  };
  await update();
  expect(text()).toContain("Subagents · 1 running");
  await click(fixture.groupHeader("Subagents")!);
  expect(fixture.groupHeader("Subagents")?.textContent).toBe("Subagents · 1 running (1)");
});

it("separates relationship kinds and collapses each group independently", async () => {
  await using screen = await setup();
  const { container, render, click, update, groupHeader } = screen;
  const environmentId = EnvironmentId.make("test");
  const current = {
    id: "current",
    status: "failed",
    activeProviderThreadId: null,
    lineage: { parentThreadId: "parent", relationshipToParent: "fork" },
  };
  const agent = {
    id: "worker",
    childThreadId: "worker-chat",
    driver: "codex",
    providerInstanceId: "codex",
    title: "Active worker",
    status: "running",
    startedAt: DateTime.makeUnsafe("2026-09-21T12:00:00Z"),
    completedAt: null,
    updatedAt: DateTime.makeUnsafe("2026-09-21T12:00:00Z"),
  };
  const projection = {
    thread: current,
    runs: [],
    providerThreads: [],
    providerSessions: [],
    contextTransfers: [
      { sourceThreadId: "current", targetThreadId: "transfer", status: "resolved_portable" },
    ],
    subagents: [
      agent,
      {
        ...agent,
        id: "finished",
        childThreadId: "finished-chat",
        title: "Finished worker",
        status: "completed",
        completedAt: DateTime.makeUnsafe("2026-09-21T12:10:00Z"),
      },
    ],
  };
  state.projection = projection;
  state.shells = [
    current,
    {
      id: "parent",
      title: "Parent conversation",
      status: "running",
      lineage: { parentThreadId: null, relationshipToParent: null },
    },
    {
      id: "fork",
      title: "Forked conversation",
      status: "completed",
      lineage: { parentThreadId: "current", relationshipToParent: "fork" },
    },
  ].map((source) => ({ environmentId, source }));
  await render(
    <ThreadRelationshipsPanel environmentId={environmentId} threadId={ThreadId.make("current")} />,
  );
  const rows = (label: string) =>
    container.querySelector(`ul[aria-label="${label}"]`)?.textContent ?? "";
  const toggleGroup = (label: string) => click(groupHeader(label)!);
  expect(rows("Parent")).toContain("Parent conversation");
  expect(rows("Parent")).not.toContain("Forked conversation");
  expect(groupHeader("Parent")?.textContent).not.toContain("failed");
  expect(rows("Forks")).toContain("Forked conversation");
  expect(rows("Forks")).not.toContain("Active worker");
  expect(rows("Context transfers")).toContain("Resolved (portable)");
  expect(rows("Subagents")).toContain("Active worker");
  expect(container.textContent).not.toContain("Finished worker");

  // A collapsing group keeps its rows until the panel's exit animation ends.
  await toggleGroup("Forks");
  await vi.waitFor(() => expect(container.textContent).not.toContain("Forked conversation"));
  expect(rows("Parent")).toContain("Parent conversation");
  expect(rows("Subagents")).toContain("Active worker");
  await toggleGroup("Previous agents");
  expect(rows("Previous agents")).toContain("Finished worker");
  expect(rows("Previous agents")).not.toContain("Active worker");

  await toggleGroup("Forks");
  expect(rows("Forks")).toContain("Forked conversation");
  await toggleGroup("Previous agents");
  state.projection = {
    ...projection,
    subagents: projection.subagents.map((subagent) => ({ ...subagent, status: "completed" })),
  };
  await update();
  await vi.waitFor(() => expect(container.textContent).not.toContain("Active worker"));
  expect(groupHeader("Previous agents")?.textContent).toContain("(2)");
  await toggleGroup("Previous agents");
  expect(rows("Previous agents")).toContain("Active worker");
  expect(rows("Previous agents")).toContain("Finished worker");
});
