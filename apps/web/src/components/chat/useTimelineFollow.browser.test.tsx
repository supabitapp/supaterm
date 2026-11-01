import type { LegendListRef } from "@legendapp/list/react";
import { MessageId } from "@supaterm/contracts";
import { createRef, useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import { act, render, stubGlobal } from "../../../test/render";
import type { ChatComposerHandle } from "./ChatComposer";
import { rememberTimelinePosition } from "./timelineScrollAnchoring";
import { useTimelineFollow } from "./useTimelineFollow";

const composerRef = createRef<ChatComposerHandle | null>();

function FollowHarness(props: {
  readonly threadKey: string;
  readonly inset: number;
  readonly anchorMessageId: MessageId | null;
  readonly listRef: React.RefObject<LegendListRef | null>;
}) {
  const [anchor, setAnchor] = useState<{
    readonly threadKey: string | null;
    readonly messageId: MessageId | null;
  }>({ threadKey: props.threadKey, messageId: props.anchorMessageId });
  const follow = useTimelineFollow({
    legendListRef: props.listRef,
    composerRef,
    composerTimelineInset: props.inset,
    routeThreadKey: props.threadKey,
    activeThreadKey: props.threadKey,
    isServerThread: false,
    serverProjection: null,
    threadStatus: "live",
    activeActivityRun: null,
    activeRunningTurnId: null,
    timelineEntries: [],
    timelineAnchorMessageId: anchor.messageId,
    setTimelineAnchor: setAnchor,
  });
  return (
    <>
      <button type="button" onClick={follow.onTimelineFooterGrowStable}>
        Footer grew
      </button>
      <output>{anchor.messageId ?? "released"}</output>
    </>
  );
}

describe("useTimelineFollow", () => {
  it.each([
    { following: true, anchorMessageId: null, scrolls: 2 },
    { following: false, anchorMessageId: null, scrolls: 0 },
    { following: true, anchorMessageId: MessageId.make("new-user-message"), scrolls: 0 },
  ])(
    "keeps the end in view when the composer inset or footer grows: following $following, anchor $anchorMessageId",
    async ({ following, anchorMessageId, scrolls }) => {
      const threadKey = `environment-local:follow-growth-${following}-${anchorMessageId}`;
      if (!following) {
        rememberTimelinePosition(
          threadKey,
          { rowId: "row", offsetWithinRow: 0, scrollOffset: 0, atEnd: false },
          false,
        );
      }
      const frames: FrameRequestCallback[] = [];
      using _frames = stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
        frames.push(callback),
      );
      const flushFrames = () => {
        for (const callback of frames.splice(0)) callback(0);
      };
      const scrollToEnd = vi.fn();
      const listRef = createRef<LegendListRef | null>();
      listRef.current = {
        scrollToEnd,
        getScrollableNode: () => null,
        getState: () => ({ isAtEnd: true, scroll: 0, scrollLength: 0, contentLength: 0 }),
      } as unknown as LegendListRef;
      const harness = (inset: number) => (
        <FollowHarness
          threadKey={threadKey}
          inset={inset}
          anchorMessageId={anchorMessageId}
          listRef={listRef}
        />
      );

      await using screen = await render(harness(80));
      await act(async () => screen.rerender(harness(40)));
      flushFrames();
      expect(scrollToEnd).not.toHaveBeenCalled();

      await act(async () => screen.rerender(harness(120)));
      flushFrames();
      await act(async () => screen.container.querySelector("button")!.click());
      flushFrames();

      expect(scrollToEnd).toHaveBeenCalledTimes(scrolls);
      expect(screen.container.querySelector("output")?.textContent).toBe(
        anchorMessageId ?? "released",
      );
    },
  );
});
