import { createMemoryHistory } from "@tanstack/react-router";
import { scopeProjectRef, scopeThreadRef } from "@supaterm/client-runtime/environment";
import { NodeId, RuntimeRequestId, TurnItemId, type ThreadId } from "@supaterm/contracts";
import { DEFAULT_CLIENT_SETTINGS } from "@supaterm/contracts/settings";
import type * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import { AsyncResult } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";
import { commands, page, userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { AppRoot } from "~/AppRoot";
import { openSideChatBeside } from "~/chatPanes/actions";
import { DraftId, useComposerDraftStore } from "~/composerDraftStore";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { getRouter, type AppRouter } from "~/router";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { vcsEnvironment } from "~/state/vcs";
import {
  ENVIRONMENT_ID,
  PROJECT_ID,
  assistantItem,
  emitTerminalMetadata,
  emitThreadEvent,
  emitVcsStatus,
  installFakeEnvironment,
  isThreadSubscribed,
  runningRun,
  threadWithHistory,
  userItem,
  type FakeDriver,
  type FakeThread,
} from "./fakeEnvironment";
import { commitsSoFar, startCounting, stopCounting, type RenderReport } from "./renderCounter";
import { act, fakeTimers, render } from "./render";

vi.mock("../../../packages/client-runtime/src/connection/driver.ts", async (importOriginal) => {
  const [actual, { fakeDriver }, Layer] = await Promise.all([
    importOriginal<{ readonly ConnectionDriver: Context.Key<unknown, FakeDriver> }>(),
    import("./fakeEnvironment"),
    import("effect/Layer"),
  ]);
  return { ...actual, layer: Layer.succeed(actual.ConnectionDriver, fakeDriver) };
});

vi.mock(import("~/rpc/requestLatencyState"), async (original) => ({
  ...(await original()),
  trackRpcRequestSent: () => {},
}));

const GIT_STATUS_UPDATES = 20;
const HISTORY_TURNS = 20;
const STREAM_DELTAS = 30;
const TYPED_TEXT = "fix the flaky tests!";
const TERMINAL_UPDATES = 20;
const THREADS = ["thread-warm", "thread-a", "thread-b", "thread-live"].map((name) =>
  threadWithHistory(name, HISTORY_TURNS),
);
const [WARM, A, B, LIVE] = THREADS.map((thread) => thread.id) as [
  ThreadId,
  ThreadId,
  ThreadId,
  ThreadId,
];

const SIDE_CHAT = { ...threadWithHistory("thread-side", HISTORY_TURNS), sideChatOf: WARM };

const QUESTION_AT = DateTime.makeUnsafe("2026-03-17T19:12:28.000Z");
const QUESTION_THREAD = threadWithHistory("thread-question", HISTORY_TURNS);
const QUESTION_REQUEST = RuntimeRequestId.make("thread-question-request");
const QUESTION = {
  ...QUESTION_THREAD,
  items: [
    ...QUESTION_THREAD.items,
    {
      id: TurnItemId.make(QUESTION_REQUEST),
      threadId: QUESTION_THREAD.id,
      runId: null,
      nodeId: NodeId.make(QUESTION_REQUEST),
      providerThreadId: null,
      providerTurnId: null,
      nativeItemRef: null,
      parentItemId: null,
      ordinal: HISTORY_TURNS * 2,
      status: "completed",
      title: null,
      startedAt: QUESTION_AT,
      completedAt: QUESTION_AT,
      updatedAt: QUESTION_AT,
      type: "user_input_request",
      requestId: QUESTION_REQUEST,
      questions: [
        {
          id: "approach",
          header: "Approach",
          question: "Which approach should I take?",
          options: [
            { label: "Incremental", description: "One module at a time" },
            { label: "Rewrite", description: "Everything at once" },
          ],
        },
        {
          id: "tests",
          header: "Tests",
          question: "Which tests should I run?",
          options: [
            { label: "Changed", description: "Only what this touches" },
            { label: "All", description: "The whole suite" },
          ],
        },
      ],
    },
  ],
  runtimeRequests: [
    {
      id: QUESTION_REQUEST,
      nodeId: NodeId.make(QUESTION_REQUEST),
      providerTurnId: null,
      nativeRequestRef: null,
      kind: "user_input",
      status: "pending",
      responseCapability: { type: "message" },
      createdAt: QUESTION_AT,
      resolvedAt: null,
    },
  ],
} satisfies FakeThread;

installFakeEnvironment([...THREADS, SIDE_CHAT, QUESTION]);
await page.viewport(1400, 900);
__setClientSettingsForTests({
  ...DEFAULT_CLIENT_SETTINGS,
  onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
});

async function quiet() {
  let seen = -1;
  await vi.waitFor(
    () => {
      const now = commitsSoFar();
      const settled = now === seen;
      seen = now;
      expect(settled).toBe(true);
    },
    { interval: 100, timeout: 15_000 },
  );
}

const frozenClock = () =>
  fakeTimers({ toFake: ["Date"], now: new Date("2026-03-18T09:00:30.000Z") });

const threadPath = (threadId: ThreadId) => `/${ENVIRONMENT_ID}/${threadId}`;
const lastAnswer = (threadId: ThreadId) =>
  page.getByText(`Answer ${HISTORY_TURNS - 1} for ${threadId}.`);

async function mountApp(path: string) {
  const router = getRouter(createMemoryHistory({ initialEntries: [path] }));
  await router.load();
  const container = document.createElement("div");
  container.style.cssText = "height: 900px; width: 1400px;";
  const screen = await render(<AppRoot router={router} />, { container, router: false });
  return { screen, router };
}

async function openThread(threadId: ThreadId) {
  const app = await mountApp(threadPath(threadId));
  await expect.element(lastAnswer(threadId)).toBeVisible();
  await quiet();
  return app;
}

const goToThread = (router: AppRouter, threadId: ThreadId) => async () => {
  await act(() =>
    router.navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId: ENVIRONMENT_ID, threadId },
    }),
  );
  await expect.element(lastAnswer(threadId)).toBeVisible();
};

async function measure(action: () => Promise<void>) {
  await quiet();
  startCounting();
  await action();
  await quiet();
  return stopCounting();
}

async function report(
  scenario: string,
  windows: ReadonlyArray<RenderReport>,
  { commits: countCommits = windows.length === 1 } = {},
) {
  const components: Record<string, number> = {};
  for (const window of windows) {
    for (const [name, count] of Object.entries(window.components)) {
      components[name] = (components[name] ?? 0) + count;
    }
  }
  const total = windows.reduce((sum, window) => sum + window.renders, 0);
  const commits = countCommits ? windows[0]!.commits : null;
  await commands.writeRenderReport(
    scenario,
    JSON.stringify({ commits, renders: total, components }),
  );
}

it("warm up", async () => {
  using _clock = frozenClock();
  const { screen, router } = await openThread(WARM);
  await using _app = screen;
  await document.fonts.ready;
  await quiet();
  await toggleDiff("open")();
  await quiet();
  await toggleDiff("close")();
  await quiet();
  await openSettings(router, "/settings/general")();
  await openSettings(router, "/settings/appearance")();
  await quiet();
});

it("app-mount-thread", async () => {
  using _clock = frozenClock();
  startCounting();
  await using _app = (await mountApp(threadPath(A))).screen;
  await expect.element(lastAnswer(A)).toBeVisible();
  await quiet();
  await report("app-mount-thread", [stopCounting()]);
});

it("app-stream-assistant-turn", async () => {
  using _clock = frozenClock();
  await using _app = (await openThread(LIVE)).screen;
  expect(isThreadSubscribed(LIVE)).toBe(true);
  const live = runningRun(LIVE, "live-run", HISTORY_TURNS + 1, "live-user");
  await act(async () => {
    await emitThreadEvent(LIVE, { type: "run.created", payload: live });
    await emitThreadEvent(LIVE, {
      type: "turn-item.updated",
      payload: userItem(LIVE, live.id, "live-user", HISTORY_TURNS * 2, "Continue"),
    });
  });
  await expect.element(page.getByText("Continue", { exact: true })).toBeVisible();
  const counted = await measure(async () => {
    let text = "";
    for (let delta = 0; delta < STREAM_DELTAS; delta++) {
      text += `word${delta}\n\n`;
      await act(() =>
        emitThreadEvent(LIVE, {
          type: "turn-item.updated",
          payload: assistantItem(
            LIVE,
            live.id,
            "live-assistant",
            HISTORY_TURNS * 2 + 1,
            text,
            true,
          ),
        }),
      );
    }
    await expect
      .element(page.getByText(`word${STREAM_DELTAS - 1}`, { exact: false }))
      .toBeVisible();
  });
  expect(counted.components.ConversationTimeline).toBeLessThanOrEqual(3);
  expect(counted.components.UserTimelineRow).toBeUndefined();
  expect(counted.components.AssistantTimelineRow).toBe(STREAM_DELTAS);
  expect(counted.components.MarkdownParagraph).toBe(STREAM_DELTAS);
  await report("app-stream-assistant-turn", [counted], { commits: false });
});

it("app-terminal-updates-in-other-thread", async () => {
  using _clock = frozenClock();
  await using _app = (await openThread(A)).screen;
  const counted = await measure(async () => {
    for (let update = 0; update < TERMINAL_UPDATES; update++) {
      await act(() =>
        emitTerminalMetadata({
          type: "upsert",
          terminal: {
            threadId: B,
            terminalId: "default",
            cwd: "/repo",
            worktreePath: null,
            status: "running",
            pid: 42,
            exitCode: null,
            exitSignal: null,
            hasRunningSubprocess: true,
            label: `command ${update}`,
            updatedAt: `2026-03-18T09:01:${String(update).padStart(2, "0")}.000Z`,
          },
        }),
      );
    }
  });
  expect(counted.components.ChatView).toBeUndefined();
  expect(counted.components.SidebarThreadRow).toBe(TERMINAL_UPDATES);
  await report("app-terminal-updates-in-other-thread", [counted]);
});

it("app-type-in-composer", async () => {
  using _clock = frozenClock();
  await using _app = (await openThread(A)).screen;
  const editor = page.getByTestId("composer-editor");
  await userEvent.click(editor);
  const counted = await measure(async () => {
    await userEvent.type(editor, TYPED_TEXT);
    await expect.element(editor).toHaveTextContent(TYPED_TEXT);
  });
  await report("app-type-in-composer", [counted]);
});

it("app-answer-question", async () => {
  using _clock = frozenClock();
  await using _app = (await openThread(QUESTION.id)).screen;
  const pick = await measure(async () => {
    await userEvent.click(page.getByRole("button", { name: /Incremental/ }));
    await expect.element(page.getByText("Which tests should I run?")).toBeVisible();
  });
  const editor = page.getByTestId("composer-editor");
  await userEvent.click(editor);
  const type = await measure(async () => {
    await userEvent.type(editor, TYPED_TEXT);
    await expect.element(editor).toHaveTextContent(TYPED_TEXT);
  });
  expect(pick.components.ChatView).toBeUndefined();
  expect(type.components.ChatView).toBeUndefined();
  await report("app-answer-question", [pick, type]);
});

it("app-switch-thread", async () => {
  using _clock = frozenClock();
  const { screen, router } = await openThread(A);
  await using _app = screen;
  const windows = [await measure(goToThread(router, B)), await measure(goToThread(router, A))];
  for (const window of windows) expect(window.components.SidebarThreadRow).toBe(3);
  await report("app-switch-thread", windows);
});

it("app-open-thread-from-draft", async () => {
  using _clock = frozenClock();
  const drafts = useComposerDraftStore.getState();
  const draftId = DraftId.make("draft-render");
  drafts.setProjectDraftThreadId(scopeProjectRef(ENVIRONMENT_ID, PROJECT_ID), draftId);
  using _draft = { [Symbol.dispose]: () => drafts.clearDraftThread(draftId) };
  const { screen, router } = await mountApp(`/draft/${draftId}`);
  await using _app = screen;
  await expect.element(page.getByText("render", { exact: true }).first()).toBeVisible();
  const counted = await measure(goToThread(router, A));
  expect(counted.components.SidebarThreadRow).toBe(1);
  await report("app-open-thread-from-draft", [counted], { commits: false });
});

const toggleDiff = (to: "open" | "close") => async () => {
  await userEvent.keyboard(
    navigator.platform.startsWith("Mac") ? "{Meta>}d{/Meta}" : "{Control>}d{/Control}",
  );
  const diff = page.getByRole("group", { name: "Diff layout" });
  if (to === "open") await expect.element(diff).toBeVisible();
  else await expect.element(diff).not.toBeInTheDocument();
};

it("app-toggle-diff-panel", async () => {
  using _clock = frozenClock();
  await using _app = (await openThread(A)).screen;
  const open = await measure(toggleDiff("open"));
  const close = await measure(toggleDiff("close"));
  await report("app-toggle-diff-panel", [open, close]);
});

const openSettings =
  (router: AppRouter, to: "/settings/general" | "/settings/appearance") => async () => {
    await act(() => router.navigate({ to }));
    const name = to === "/settings/general" ? "Time format" : "Interface";
    await expect.element(page.getByRole("heading", { name, exact: true })).toBeVisible();
    if (to === "/settings/appearance") {
      await vi.waitFor(
        () =>
          expect([...document.querySelectorAll("div")].some((node) => node.shadowRoot)).toBe(true),
        { interval: 100, timeout: 15_000 },
      );
    }
  };

it("app-open-settings", async () => {
  using _clock = frozenClock();
  const { screen, router } = await openThread(A);
  await using _app = screen;
  await report("app-open-settings", [await measure(openSettings(router, "/settings/general"))]);
});

it("app-switch-settings-section", async () => {
  using _clock = frozenClock();
  const { screen, router } = await openThread(A);
  await using _app = screen;
  await openSettings(router, "/settings/general")();
  await report("app-switch-settings-section", [
    await measure(openSettings(router, "/settings/appearance")),
  ]);
});

it("app-git-file-counts-with-side-chat", async () => {
  using _clock = frozenClock();
  await using _app = (await openThread(WARM)).screen;
  const sideChat = {
    kind: "server",
    threadRef: scopeThreadRef(ENVIRONMENT_ID, SIDE_CHAT.id),
  } as const;
  await act(() =>
    openSideChatBeside(sideChat, { parentRef: scopeThreadRef(ENVIRONMENT_ID, WARM), sideChat }),
  );
  await expect.element(lastAnswer(SIDE_CHAT.id)).toBeVisible();
  const gitStatus = vcsEnvironment.status({
    environmentId: ENVIRONMENT_ID,
    input: { cwd: "/workspace/render" },
  });
  const local = (insertions: number, refName = "main") => ({
    isRepo: true,
    hasPrimaryRemote: true,
    isDefaultRef: true,
    refName,
    hasWorkingTreeChanges: true,
    workingTree: {
      files: [{ path: "src/app.ts", insertions, deletions: 0 }],
      insertions,
      deletions: 0,
    },
  });
  await act(() => emitVcsStatus({ _tag: "snapshot", local: local(0), remote: null }));
  const counted = await measure(async () => {
    for (let update = 1; update <= GIT_STATUS_UPDATES; update++) {
      await act(() => emitVcsStatus({ _tag: "localUpdated", local: local(update) }));
    }
    await vi.waitFor(() => {
      const status = AsyncResult.getOrElse(appAtomRegistry.get(gitStatus), () => null);
      expect(status?.workingTree.insertions).toBe(GIT_STATUS_UPDATES);
    });
  });
  expect(counted.components.ChatView).toBeUndefined();
  const branchSwitch = await measure(() =>
    act(() => emitVcsStatus({ _tag: "localUpdated", local: local(0, "feature") })),
  );
  expect(branchSwitch.components.ChatView).toBe(2);
  await report("app-git-file-counts-with-side-chat", [counted]);
});

it("app-git-status-updates-with-side-chat", async () => {
  using _clock = frozenClock();
  await using _app = (await openThread(WARM)).screen;
  const sideChat = {
    kind: "server",
    threadRef: scopeThreadRef(ENVIRONMENT_ID, SIDE_CHAT.id),
  } as const;
  await act(() =>
    openSideChatBeside(sideChat, { parentRef: scopeThreadRef(ENVIRONMENT_ID, WARM), sideChat }),
  );
  await expect.element(lastAnswer(SIDE_CHAT.id)).toBeVisible();
  const local = (insertions: number) => ({
    isRepo: true,
    hasPrimaryRemote: true,
    isDefaultRef: true,
    refName: "main",
    hasWorkingTreeChanges: insertions % 2 === 1,
    workingTree: {
      files: [{ path: "src/app.ts", insertions, deletions: 0 }],
      insertions,
      deletions: 0,
    },
  });
  await act(() => emitVcsStatus({ _tag: "snapshot", local: local(0), remote: null }));
  const counted = await measure(async () => {
    for (let update = 1; update <= GIT_STATUS_UPDATES; update++) {
      await act(() => emitVcsStatus({ _tag: "localUpdated", local: local(update) }));
    }
  });
  expect(counted.components.ChatView).toBe(GIT_STATUS_UPDATES * 2);
  await report("app-git-status-updates-with-side-chat", [counted]);
});
