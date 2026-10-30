import { act, fakeTimers, render as renderUi, type Screen } from "../../../test/render";
import { EnvironmentId, MessageId, RunId } from "@supaterm/contracts";
import type { LegendListRef } from "@legendapp/list/react";
import {
  createRef,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { describe, expect, it, vi } from "vite-plus/test";

// These cases assert the end-follow decisions the timeline hands its list, so the list renders
// its rows plainly and reports whether it is asked to keep the end in view.
vi.mock(import("@legendapp/list/react"), async (original) => ({
  ...(await original()),
  LegendList: ((props: {
    data: ReadonlyArray<{ id: string }>;
    keyExtractor: (item: { id: string }) => string;
    renderItem: (args: { item: { id: string } }) => ReactNode;
    ListHeaderComponent?: ReactNode;
    ListFooterComponent?: ReactNode;
    maintainScrollAtEnd?: unknown;
  }) => (
    <div
      data-testid="legend-list"
      data-maintain-scroll-at-end={props.maintainScrollAtEnd ? "enabled" : undefined}
    >
      {props.ListHeaderComponent}
      {props.data.map((item) => (
        <div key={props.keyExtractor(item)}>{props.renderItem({ item })}</div>
      ))}
      {props.ListFooterComponent}
    </div>
  )) as never,
}));

import { MessagesTimeline } from "./MessagesTimeline";
import { useTimelineFollow } from "./useTimelineFollow";
import { attachTimelineViewport, type TimelineViewport } from "./timelineViewport";
import { makeStreamingTimelineFixture } from "../../test-fixtures";

const ENVIRONMENT_ID = EnvironmentId.make("environment-local");
const CREATED_AT = "2026-03-17T19:12:28.000Z";

type TimelineProps = ComponentProps<typeof MessagesTimeline>;

let threadCount = 0;

function baseProps(): Omit<TimelineProps, "timelineEntries"> {
  threadCount += 1;
  return {
    isWorking: false,
    emptyPlaceholderInset: 0,
    activeTurnInProgress: false,
    listRef: createRef<LegendListRef | null>(),
    latestRun: null,
    turnDiffSummaries: [],
    runs: [],
    routeThreadKey: `environment-local:follow-thread-${threadCount}`,
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
    liveFollowEnabled: true,
    onIsAtEndChange: () => {},
    onManualNavigation: () => {},
  };
}

let fixtureScreen: Screen;
let container: HTMLDivElement;
const frames = new Map<number, FrameRequestCallback>();

async function flushFrames(count: number) {
  for (let index = 0; index < count; index += 1) {
    await act(async () => {
      const callbacks = [...frames.values()];
      frames.clear();
      for (const callback of callbacks) callback(0);
    });
  }
}

describe("MessagesTimeline end-follow", () => {
  it.each([
    { liveFollowEnabled: true, returnsToEnd: true },
    { liveFollowEnabled: false, returnsToEnd: false },
  ])(
    "returns output closed at the live edge to the end after rows stream in: $liveFollowEnabled",
    async ({ liveFollowEnabled, returnsToEnd }) => {
      await using _fixture = await setup();

      const props = baseProps();
      let timelineIsAtEnd = true;
      const scrollToEnd = vi.fn(() => {
        timelineIsAtEnd = true;
      });
      props.listRef.current = {
        getState: () => ({ isAtEnd: timelineIsAtEnd, indexByKey: () => undefined }),
        getScrollableNode: () => null,
        scrollToEnd,
      } as unknown as LegendListRef;
      const onToolOutputCollapsedAtEnd = vi.fn();
      await act(async () =>
        fixtureScreen.rerender(
          <MessagesTimeline
            {...props}
            liveFollowEnabled={liveFollowEnabled}
            onToolOutputCollapsedAtEnd={onToolOutputCollapsedAtEnd}
            timelineEntries={[
              {
                id: "tool-at-end",
                kind: "work",
                createdAt: CREATED_AT,
                entry: {
                  id: "tool-at-end",
                  createdAt: CREATED_AT,
                  label: "Run command",
                  tone: "tool",
                  toolLifecycleStatus: "completed",
                  detail: "Command output",
                },
              },
            ]}
          />,
        ),
      );
      const toggle = container.querySelector<HTMLElement>('[aria-expanded="false"]')!;
      await act(async () => toggle.click());
      await flushFrames(3);
      scrollToEnd.mockClear();

      await act(async () => toggle.click());
      // A streamed row lands below while end-follow is held.
      timelineIsAtEnd = false;
      await flushFrames(3);

      if (returnsToEnd) {
        expect(scrollToEnd).toHaveBeenCalledExactlyOnceWith({ animated: false });
      } else {
        expect(scrollToEnd).not.toHaveBeenCalled();
      }
      expect(onToolOutputCollapsedAtEnd).toHaveBeenCalledTimes(returnsToEnd ? 1 : 0);
    },
  );

  it("holds end-follow off until a disclosure nested in a row settles", async () => {
    await using _fixture = await setup();

    const following = () =>
      container
        .querySelector('[data-testid="legend-list"]')
        ?.getAttribute("data-maintain-scroll-at-end") === "enabled";
    const text = Array.from({ length: 9 }, (_, index) =>
      index === 8
        ? "deep hidden detail only after expand"
        : `Line ${index + 1}: ${"verbose prompt content ".repeat(8).trim()}`,
    ).join("\n");
    await act(async () =>
      fixtureScreen.rerender(
        <MessagesTimeline
          {...baseProps()}
          timelineEntries={[
            {
              id: "entry-1",
              kind: "message",
              createdAt: CREATED_AT,
              message: {
                id: MessageId.make("message-1"),
                role: "user",
                text,
                runId: null,
                createdAt: CREATED_AT,
                updatedAt: CREATED_AT,
                streaming: false,
              },
            },
          ]}
        />,
      ),
    );
    expect(following()).toBe(true);

    const toggle = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Show full message",
    )!;
    await act(async () => toggle.click());
    expect(following()).toBe(false);
    await flushFrames(2);
    expect(following()).toBe(false);
    await flushFrames(1);
    expect(following()).toBe(true);
  });
});

async function setup() {
  frames.clear();
  let nextFrame = 0;
  // Frames are stepped by hand so each assertion lands between two paints.
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((frame) => {
    frames.delete(frame);
  });
  container = document.body.appendChild(document.createElement("div"));
  fixtureScreen = await renderUi(null, { container });

  const ownedScreen = fixtureScreen;
  return {
    async [Symbol.asyncDispose]() {
      await ownedScreen[Symbol.asyncDispose]();

      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    },
  };
}

type FollowInput = Omit<Parameters<typeof useTimelineFollow>[0], "legendListRef">;

function runInput(
  threadKey: string,
  runId: RunId,
  status: "running" | "queued" = "running",
  hasMessage = true,
): FollowInput {
  const fixture = makeStreamingTimelineFixture();
  const source = fixture.visibleTurnItems.find((row) => row.item.type === "user_message");
  if (!source || source.item.type !== "user_message")
    throw new Error("Missing user message fixture");
  return {
    routeThreadKey: threadKey,
    activeThreadKey: threadKey,
    composerTimelineInset: 0,
    isServerThread: true,
    threadStatus: "live",
    activeActivityRun: { runId, status },
    activeRunningTurnId: null,
    timelineEntries: [],
    serverProjection: {
      runs: [],
      visibleTurnItems: hasMessage
        ? [
            {
              ...source,
              item: { ...source.item, runId, messageId: MessageId.make(`${runId}-message`) },
            },
          ]
        : [],
    },
  };
}

function FollowProbe({
  input,
  name = "left",
  sendTo = input.activeThreadKey ?? input.routeThreadKey,
}: {
  input: FollowInput;
  name?: string;
  sendTo?: string;
}) {
  const listRef = useRef<LegendListRef | null>(null);
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const viewportRef = useRef<TimelineViewport | null>(null);
  const follow = useTimelineFollow({ ...input, legendListRef: listRef });
  const attachViewport = follow.attachTimelineViewport;
  useLayoutEffect(() => {
    if (!node) return;
    const viewport = attachTimelineViewport(node);
    viewportRef.current = viewport;
    const detach = attachViewport(viewport);
    return () => {
      detach();
      viewport.dispose();
    };
  }, [node, attachViewport]);
  return (
    <div ref={setNode}>
      <output data-testid={`${name}-anchor`}>{follow.timelineAnchorMessageId ?? "none"}</output>
      <output data-testid={`${name}-following`}>{String(follow.timelineLiveFollowEnabled)}</output>
      <output data-testid={`${name}-scroll-button`}>{String(follow.showScrollToBottom)}</output>
      <button onClick={() => follow.anchorNewTurn(sendTo, MessageId.make(`${name}-local`))}>
        Send {name}
      </button>
      <button onClick={() => viewportRef.current?.navigate({ releasesFollow: true })}>
        Navigate {name}
      </button>
      <button onClick={() => follow.onIsAtEndChangeStable(false)}>Away {name}</button>
      <button onClick={() => follow.scrollToEnd()}>End {name}</button>
      <button onClick={() => follow.onTimelineFooterGrowStable()}>Footer {name}</button>
    </div>
  );
}

describe("per-thread timeline follow", () => {
  it("treats hydration as history, then anchors a remote run once its user row arrives", async () => {
    const current = runInput("follow-hydration", RunId.make("history"));
    await using screen = await renderUi(
      <FollowProbe input={{ ...current, threadStatus: "synchronizing", serverProjection: null }} />,
    );
    await screen.rerender(<FollowProbe input={current} />);
    await expect.element(screen.getByTestId("left-anchor")).toHaveTextContent("none");
    const remote = runInput("follow-hydration", RunId.make("remote"), "running", false);
    await screen.rerender(<FollowProbe input={remote} />);
    await expect.element(screen.getByTestId("left-anchor")).toHaveTextContent("none");
    await screen.rerender(
      <FollowProbe input={runInput("follow-hydration", RunId.make("remote"))} />,
    );
    await expect.element(screen.getByTestId("left-anchor")).toHaveTextContent("remote-message");
    await screen.getByRole("button", { name: "Footer left", exact: true }).click();
    await expect.element(screen.getByTestId("left-anchor")).toHaveTextContent("remote-message");
    await screen.getByRole("button", { name: "End left", exact: true }).click();
    await screen.rerender(
      <FollowProbe input={runInput("follow-hydration", RunId.make("remote"))} />,
    );
    await expect.element(screen.getByTestId("left-anchor")).toHaveTextContent("none");
  });

  it("waits for queued work to start and preserves a local send through acknowledgement", async () => {
    const current = runInput("follow-queue", RunId.make("history"));
    await using screen = await renderUi(<FollowProbe input={current} />);
    await screen.rerender(
      <FollowProbe input={runInput("follow-queue", RunId.make("queued"), "queued")} />,
    );
    await expect.element(screen.getByTestId("left-anchor")).toHaveTextContent("none");
    await screen.rerender(<FollowProbe input={runInput("follow-queue", RunId.make("queued"))} />);
    await expect.element(screen.getByTestId("left-anchor")).toHaveTextContent("queued-message");
    await screen.getByRole("button", { name: "Send left", exact: true }).click();
    await screen.rerender(
      <FollowProbe input={runInput("follow-queue", RunId.make("acknowledged"))} />,
    );
    await expect.element(screen.getByTestId("left-anchor")).toHaveTextContent("left-local");
  });

  it("keeps navigation cancellation local to its pane and resets it for a different thread", async () => {
    using _timers = fakeTimers();
    const left = runInput("follow-left", RunId.make("left-history"));
    const right = runInput("follow-right", RunId.make("right-history"));
    const panes = (leftInput: FollowInput, rightInput = right) => (
      <>
        <FollowProbe name="left" input={leftInput} />
        <FollowProbe name="right" input={rightInput} />
      </>
    );
    await using screen = await renderUi(panes(left));
    await screen.getByRole("button", { name: "Navigate left", exact: true }).click();
    await expect.element(screen.getByTestId("left-following")).toHaveTextContent("false");
    await expect.element(screen.getByTestId("right-following")).toHaveTextContent("true");
    await screen.rerender(
      panes(
        runInput("follow-left", RunId.make("ignored")),
        runInput("follow-right", RunId.make("remote-right")),
      ),
    );
    await expect.element(screen.getByTestId("left-anchor")).toHaveTextContent("none");
    await expect
      .element(screen.getByTestId("right-anchor"))
      .toHaveTextContent("remote-right-message");
    await screen.getByRole("button", { name: "Away left", exact: true }).click();
    await screen.rerender(panes(runInput("follow-replacement", RunId.make("replacement"))));
    await act(() => vi.advanceTimersByTimeAsync(200));
    await expect.element(screen.getByTestId("left-following")).toHaveTextContent("true");
    await expect.element(screen.getByTestId("left-scroll-button")).toHaveTextContent("false");
    await expect.element(screen.getByTestId("left-anchor")).toHaveTextContent("none");
  });

  it("carries the local anchor into its promoted draft and releases it when the run settles", async () => {
    const draft = {
      ...runInput("follow-draft", RunId.make("draft")),
      activeThreadKey: null,
      serverProjection: null,
      isServerThread: false,
    };
    await using screen = await renderUi(<FollowProbe input={draft} sendTo="follow-promoted" />);
    await screen.getByRole("button", { name: "Send left", exact: true }).click();
    await screen.rerender(
      <FollowProbe input={runInput("follow-promoted", RunId.make("local-run"))} />,
    );
    await expect.element(screen.getByTestId("left-anchor")).toHaveTextContent("left-local");
    const settled = runInput("follow-promoted", RunId.make("local-run"));
    if (!settled.serverProjection) throw new Error("Missing projection");
    await screen.rerender(
      <FollowProbe
        input={{
          ...settled,
          serverProjection: {
            ...settled.serverProjection,
            runs: [{ userMessageId: MessageId.make("left-local"), status: "completed" }],
          },
        }}
      />,
    );
    await expect.element(screen.getByTestId("left-anchor")).toHaveTextContent("none");
  });
});
