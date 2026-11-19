import { EnvironmentId, MessageId } from "@supaterm/contracts";
import type { LegendListRef } from "@legendapp/list/react";
import { createRef, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { expect, it, vi } from "vite-plus/test";
import { commands, userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { MessagesTimeline } from "~/components/chat/MessagesTimeline";
import {
  ComposerPromptEditorTiptap as ComposerPromptEditor,
  type ComposerPromptEditorHandle,
} from "~/components/ComposerPromptEditorTiptap";
import { commitsSoFar, startCounting, stopCounting } from "./renderCounter";
import { render } from "./render";

declare module "vite-plus/test/browser" {
  interface BrowserCommands {
    /** Defined in vite.config.ts for the renders project. */
    writeRenderReport: (scenario: string, json: string) => Promise<void>;
  }
}

vi.mock(import("~/state/query"), async (original) => ({
  ...(await original()),
  useEnvironmentQuery: (() => ({
    data: { tasks: [] },
    dataUpdatedAt: 0,
    error: null,
    failure: null,
    isPending: false,
    isSuccess: true,
    refresh: () => {},
  })) as never,
}));

const ENVIRONMENT_ID = EnvironmentId.make("environment-local");
const CREATED_AT = "2026-03-17T19:12:28.000Z";
const HISTORY_TURNS = 20;
const STREAM_DELTAS = 30;
const TYPED_TEXT = "fix the flaky tests!";

type TimelineProps = ComponentProps<typeof MessagesTimeline>;
type Entry = TimelineProps["timelineEntries"][number];

function message(id: string, role: "user" | "assistant", text: string, streaming = false) {
  return {
    id: `entry-${id}`,
    kind: "message",
    createdAt: CREATED_AT,
    message: {
      id: MessageId.make(id),
      role,
      text,
      runId: null,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
      streaming,
    },
  } as Entry;
}

function history(thread: string) {
  return Array.from({ length: HISTORY_TURNS }, (_, turn) => [
    message(`${thread}-user-${turn}`, "user", `${thread}: question ${turn} about the sidebar`),
    message(
      `${thread}-assistant-${turn}`,
      "assistant",
      `Answer ${turn} for ${thread}.\n\n- checked \`Sidebar.tsx\`\n- ran the tests\n\n` +
        "The width is now `clamp(next, MIN_WIDTH, MAX_WIDTH)`, so the layout no longer jumps.",
    ),
  ]).flat();
}

const versionedProps = { onManualNavigation: () => {}, onJumpToPinnedMessage: () => {} };

function timelineFor() {
  const props: Omit<
    TimelineProps,
    "timelineEntries" | "routeThreadKey" | keyof typeof versionedProps
  > = {
    isWorking: false,
    listRef: createRef<LegendListRef | null>(),
    latestRun: null,
    turnDiffSummaries: [],
    runs: [],
    onOpenTurnDiff: () => {},
    onOpenThread: () => {},
    onForkFromRun: async () => {},
    supportsConversationRollback: false,
    onRevertToTurnCount: () => {},
    isRevertingCheckpoint: false,
    onImageExpand: () => {},
    activeThreadEnvironmentId: ENVIRONMENT_ID,
    markdownCwd: undefined,
    resolvedTheme: "light",
    timestampFormat: "locale",
    workspaceRoot: undefined,
    anchorMessageId: null,
    onAnchorReady: () => {},
    onAnchorSizeChanged: () => {},
    contentInsetEndAdjustment: 0,
    emptyPlaceholderInset: 0,
    liveFollowEnabled: true,
    onIsAtEndChange: () => {},
  };
  return (thread: string, entries: Entry[]) => (
    <MessagesTimeline
      {...props}
      timelineEntries={entries}
      routeThreadKey={`environment-local:${thread}`}
      {...versionedProps}
    />
  );
}

function sizedContainer() {
  const container = document.createElement("div");
  container.style.cssText = "height: 900px; width: 900px; display: flex; flex-direction: column;";
  return container;
}

async function quiet() {
  let seen = -1;
  await vi.waitFor(
    () => {
      const now = commitsSoFar();
      const settled = now === seen;
      seen = now;
      expect(settled).toBe(true);
    },
    { interval: 100, timeout: 10_000 },
  );
}

function onGuestPage() {
  const previous = `${window.location.pathname}${window.location.search}`;
  window.history.replaceState(window.history.state, "", "/guest?share=render-scenarios");
  return {
    [Symbol.dispose]: () => window.history.replaceState(window.history.state, "", previous),
  };
}

async function warmUp(ui: ReactNode, container?: HTMLElement) {
  await using screen = await render(ui, container ? { container } : {});
  await document.fonts.ready;
  await quiet();
  expect(screen.container.childElementCount).toBeGreaterThan(0);
}

async function report(scenario: string) {
  await quiet();
  const counts = stopCounting();
  await commands.writeRenderReport(scenario, JSON.stringify(counts));
}

it("mount-thread", async () => {
  using _guest = onGuestPage();
  const timeline = timelineFor();
  await warmUp(timelineFor()("thread-warm", history("thread-warm")), sizedContainer());
  startCounting();
  await using screen = await render(timeline("thread-a", history("thread-a")), {
    container: sizedContainer(),
  });
  await expect.element(screen.getByText(`Answer ${HISTORY_TURNS - 1} for thread-a.`)).toBeVisible();
  await report("mount-thread");
});

it("stream-assistant-turn", async () => {
  using _guest = onGuestPage();
  const timeline = timelineFor();
  const base = history("thread-a");
  const streamed = (text: string) => [
    ...base,
    message("live-user", "user", "Continue"),
    message("live-assistant", "assistant", text, true),
  ];
  await warmUp(timelineFor()("thread-warm", streamed("warm")), sizedContainer());
  await using screen = await render(timeline("thread-a", streamed("")), {
    container: sizedContainer(),
  });
  await expect.element(screen.getByText("Continue")).toBeVisible();
  await quiet();

  startCounting();
  let text = "";
  for (let delta = 0; delta < STREAM_DELTAS; delta++) {
    text += `word${delta} `;
    await screen.rerender(timeline("thread-a", streamed(text)));
  }
  await expect
    .element(screen.getByText(`word${STREAM_DELTAS - 1}`, { exact: false }))
    .toBeVisible();
  await report("stream-assistant-turn");
});

it("switch-thread", async () => {
  using _guest = onGuestPage();
  const timeline = timelineFor();
  const a = history("thread-a");
  const b = history("thread-b");
  const lastAnswer = (thread: string) =>
    screen.getByText(`Answer ${HISTORY_TURNS - 1} for ${thread}.`);
  await warmUp(timelineFor()("thread-warm", a), sizedContainer());
  await using screen = await render(timeline("thread-a", a), { container: sizedContainer() });
  await expect.element(lastAnswer("thread-a")).toBeVisible();

  await quiet();
  startCounting();
  await screen.rerender(timeline("thread-b", b));
  await expect.element(lastAnswer("thread-b")).toBeVisible();
  await quiet();
  const toB = stopCounting();
  startCounting();
  await screen.rerender(timeline("thread-a", a));
  await expect.element(lastAnswer("thread-a")).toBeVisible();
  await quiet();
  const toA = stopCounting();

  const components = { ...toB.components };
  for (const [name, count] of Object.entries(toA.components)) {
    components[name] = (components[name] ?? 0) + count;
  }
  await commands.writeRenderReport(
    "switch-thread",
    JSON.stringify({
      commits: null,
      renders: toB.renders + toA.renders,
      components,
    }),
  );
});

function Composer() {
  const [prompt, setPrompt] = useState({ value: "", cursor: 0 });
  const editorRef = useRef<ComposerPromptEditorHandle>(null);
  return (
    <ComposerPromptEditor
      editorRef={editorRef}
      value={prompt.value}
      cursor={prompt.cursor}
      richTextEnabled
      contextRecords={new Map()}
      skills={[]}
      disabled={false}
      placeholder="Ask anything"
      onChange={(value, cursor) => setPrompt({ value, cursor })}
      onPaste={() => {}}
    />
  );
}

it("type-in-composer", async () => {
  using _guest = onGuestPage();
  await warmUp(<Composer />);
  await using screen = await render(<Composer />);
  const editor = screen.getByRole("textbox");
  await userEvent.click(editor);
  await quiet();

  startCounting();
  await userEvent.type(editor, TYPED_TEXT);
  await expect.element(editor).toHaveTextContent(TYPED_TEXT);
  await report("type-in-composer");
});
