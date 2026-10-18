import { EnvironmentId, MessageId } from "@supaterm/contracts";
import type { LegendListRef } from "@legendapp/list/react";
import { act, createRef, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

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

const ENVIRONMENT_ID = EnvironmentId.make("environment-local");
const CREATED_AT = "2026-03-17T19:12:28.000Z";

type TimelineProps = ComponentProps<typeof MessagesTimeline>;

let threadCount = 0;

function baseProps(): Omit<TimelineProps, "timelineEntries"> {
  threadCount += 1;
  return {
    isWorking: false,
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

let root: Root;
let container: HTMLDivElement;
const frames = new Map<number, FrameRequestCallback>();

beforeEach(() => {
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
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

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
        root.render(
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
      root.render(
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
