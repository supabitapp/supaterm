import {
  navigationReleasesFollow,
  type TimelineViewport,
  type TimelineNavigation,
} from "./timelineViewport";
import { measuredEndOffset, settleListScroll } from "./useTimelinePositionRestore";
import { useStableCallback } from "../../hooks/useStableCallback";
import { type MessageId, type ThreadId, type RunId } from "@supaterm/contracts";
import { CHAT_LIST_ANCHOR_OFFSET } from "@supaterm/shared/chatList";
import { Debouncer } from "@tanstack/react-pacer";
import { type SetStateAction, useEffect, useLayoutEffect, useRef, useState } from "react";
import { type LegendListRef } from "@legendapp/list/react";
import {
  CHAT_TIMELINE_ANCHOR_OFFSET,
  timelineContentOverflowsViewport,
  readTimelinePosition,
  observeTimelineRun,
  type TimelineRunObservation,
  type TimelineScrollMode,
} from "./timelineScrollAnchoring";
import { createPageScrollController, type PageScrollKey } from "./pageScrollController";
import { resolveTimelineIsAtEnd } from "./MessagesTimeline.logic";
import {
  releaseChatTimelineAnchor,
  shouldReleaseTimelineAnchorForToolActivity,
} from "../ChatView.logic";
import { prefersReducedMotion } from "../../lib/motion";
import type { Dispatch, RefObject } from "react";
import type { ThreadStructure } from "@supaterm/client-runtime/state/shell";
import type { deriveThreadActivityRun } from "@supaterm/client-runtime/state/thread-execution";
import type { EnvironmentThreadStatus } from "@supaterm/client-runtime/state/threads";
import type { TimelineEntry } from "../../session-logic";
import type { ChatShortcutCommands } from "./useChatShortcuts";

const TIMELINE_SCROLL_CANCEL_SENTINEL = Object.freeze({});
const CONVERSATION_SCROLL_STEP_PX = 160;

interface TimelineAnchor {
  readonly threadKey: string | null;
  readonly messageId: MessageId | null;
}

interface TimelineFollowInput {
  readonly legendListRef: RefObject<LegendListRef | null>;
  readonly composerOverlayElement?: HTMLDivElement | null;
  readonly composerTimelineInset: number;
  readonly routeThreadKey: string;
  readonly activeThreadKey: string | null;
  readonly activeThreadId?: ThreadId | undefined;
  readonly isServerThread: boolean;
  readonly serverProjection: ThreadStructure | null;
  readonly threadStatus: EnvironmentThreadStatus;
  readonly activeActivityRun: ReturnType<typeof deriveThreadActivityRun>;
  readonly activeRunningTurnId: RunId | null;
  readonly timelineEntries: ReadonlyArray<TimelineEntry>;
  readonly timelineAnchorMessageId: MessageId | null;
  readonly setTimelineAnchor: Dispatch<SetStateAction<TimelineAnchor>>;
}

/**
 * Keeps the timeline following the live end, anchoring a newly sent turn near
 * the top, and letting the user scroll away. The scroll handlers read refs, so
 * a scroll gesture does not re-render ChatView unless the follow mode flips.
 * A thread opens at its remembered reading position.
 */
export function useTimelineFollow(input: TimelineFollowInput) {
  const viewportRef = useRef<TimelineViewport | null>(null);
  const {
    legendListRef,
    composerOverlayElement = null,
    composerTimelineInset,
    routeThreadKey,
    activeThreadKey,
    isServerThread,
    serverProjection,
    threadStatus,
    activeActivityRun,
    activeRunningTurnId,
    timelineEntries,
    timelineAnchorMessageId,
    setTimelineAnchor,
  } = input;
  const [showScrollToBottom, setShowScrollToBottom] = useState(
    () => readTimelinePosition(routeThreadKey)?.atEnd === false,
  );
  const isAtEndRef = useRef(true);
  const isTimelineAtLogicalEnd = () =>
    resolveTimelineIsAtEnd(legendListRef.current?.getState()) ?? isAtEndRef.current;
  const isTimelineAtLogicalEndStable = useStableCallback(isTimelineAtLogicalEnd);
  // Debounce *showing* the scroll-to-bottom pill so it doesn't flash during
  // thread switches. LegendList fires scroll events with isAtEnd=false while
  // initialScrollAtEnd is settling; hiding is always immediate.
  const showScrollDebouncer = useRef(
    new Debouncer(() => setShowScrollToBottom(true), { wait: 150 }),
  );
  const timelineScrollIntentRef = useRef<"toward-end" | "away-from-end" | null>(null);
  const timelineScrollModeRef = useRef<TimelineScrollMode>("following-end");
  // State mirror of the follow mode refs. LegendList's maintainScrollAtEnd
  // re-pins on its own (independent of the refs), so the timeline needs a
  // render-visible flag to switch it off once the user scrolls away.
  const [timelineLiveFollowEnabled, setTimelineLiveFollowEnabled] = useState(
    () => readTimelinePosition(routeThreadKey)?.atEnd !== false,
  );
  const pendingTimelineAnchorRef = useRef<MessageId | null>(null);
  const positionedTimelineAnchorRef = useRef<MessageId | null>(null);
  const settledTimelineAnchorRef = useRef<MessageId | null>(null);
  const activeTimelineAnchorIndexRef = useRef<number | null>(null);
  const observedTimelineActivityRef = useRef<TimelineRunObservation | null>(null);
  const anchorUserScrollGenerationRef = useRef(0);
  const cancelPositionRestoreRef = useRef<(() => void) | null>(null);
  const liveFollowUserScrollGenerationRef = useRef<number | null>(0);
  const pendingAnchorScrollRestoreRef = useRef<{
    readonly messageId: MessageId;
    readonly offset: number;
    readonly userScrollGeneration: number;
  } | null>(null);
  const anchorScrollRestoreFrameRef = useRef<number | null>(null);
  const cancelTimelineLiveFollowForUserNavigation = () => {
    cancelPositionRestoreRef.current?.();
    anchorUserScrollGenerationRef.current += 1;
    const wasProgrammaticScrollMode = timelineScrollModeRef.current !== "free-scrolling";
    timelineScrollModeRef.current = "free-scrolling";
    liveFollowUserScrollGenerationRef.current = null;
    setTimelineLiveFollowEnabled(false);
    pendingTimelineAnchorRef.current = null;
    positionedTimelineAnchorRef.current = null;
    settledTimelineAnchorRef.current = null;
    activeTimelineAnchorIndexRef.current = null;
    pendingAnchorScrollRestoreRef.current = null;
    if (anchorScrollRestoreFrameRef.current !== null) {
      cancelAnimationFrame(anchorScrollRestoreFrameRef.current);
      anchorScrollRestoreFrameRef.current = null;
    }
    if (wasProgrammaticScrollMode) {
      // While following or anchoring, our scrollToEnd/scrollToOffset calls can
      // sit in LegendList's pending-imperative-scroll queue (it defers them
      // while layout settles) and fire seconds later with stale targets,
      // yanking the view away after the user scrolled. Starting a new
      // imperative scroll cancels everything queued; targeting an item that
      // is not in the data makes the new request itself resolve without ever
      // scrolling, so this is a pure cancel.
      void legendListRef.current?.scrollToItem({
        item: TIMELINE_SCROLL_CANCEL_SENTINEL,
        animated: false,
      });
      // An already-started animated scroll (behavior: smooth) keeps running in
      // the browser regardless of the queue; a same-position instant write is
      // the only way to halt it where it is.
      const scrollNode = legendListRef.current?.getScrollableNode() as
        | { scrollTop?: number }
        | null
        | undefined;
      const currentScrollTop = scrollNode?.scrollTop;
      if (scrollNode && typeof currentScrollTop === "number") {
        scrollNode.scrollTop = currentScrollTop;
      }
    }
  };
  const cancelTimelineLiveFollowForUserNavigationStable = useStableCallback(
    cancelTimelineLiveFollowForUserNavigation,
  );

  useEffect(() => {
    const previous = observedTimelineActivityRef.current;
    const dispatchedUserItem =
      previous?.hydrated &&
      previous.threadKey === activeThreadKey &&
      activeActivityRun !== null &&
      previous.runId !== activeActivityRun.runId
        ? serverProjection?.visibleTurnItems.find(
            (row) => row.item.type === "user_message" && row.item.runId === activeActivityRun.runId,
          )
        : undefined;
    const { observation, anchorMessageId: messageId } = observeTimelineRun(previous, {
      threadKey: activeThreadKey,
      hydrated: !isServerThread || (serverProjection !== null && threadStatus === "live"),
      runId: activeActivityRun?.runId ?? null,
      queued: activeActivityRun?.status === "queued",
      messageId:
        dispatchedUserItem?.item.type === "user_message" ? dispatchedUserItem.item.messageId : null,
    });
    observedTimelineActivityRef.current = observation;
    if (messageId === null) return;
    if (
      pendingTimelineAnchorRef.current !== null ||
      timelineScrollModeRef.current === "free-scrolling"
    ) {
      return;
    }

    isAtEndRef.current = true;
    timelineScrollModeRef.current = "anchoring-new-turn";
    liveFollowUserScrollGenerationRef.current = anchorUserScrollGenerationRef.current;
    pendingTimelineAnchorRef.current = messageId;
    activeTimelineAnchorIndexRef.current = null;
    showScrollDebouncer.current.cancel();
    setShowScrollToBottom(false);
    setTimelineAnchor({ threadKey: activeThreadKey, messageId });
  }, [
    activeActivityRun,
    activeThreadKey,
    isServerThread,
    serverProjection,
    setTimelineAnchor,
    threadStatus,
  ]);
  const timelineRealContentOverflowsViewport = (list?: LegendListRef | null) =>
    timelineContentOverflowsViewport((list ?? legendListRef.current)?.getState(), {
      composerInset: composerTimelineInset,
      anchorOffset: CHAT_TIMELINE_ANCHOR_OFFSET,
    });
  const timelineRealContentOverflowsViewportStable = useStableCallback(
    timelineRealContentOverflowsViewport,
  );
  const pageScrollControllerRef = useRef<ReturnType<typeof createPageScrollController> | null>(
    null,
  );
  const handlePageScrollStart = useStableCallback((key: PageScrollKey) => {
    timelineScrollIntentRef.current = key === "PageUp" ? "away-from-end" : "toward-end";
    if (
      (key === "PageUp" && timelineRealContentOverflowsViewportStable()) ||
      !isTimelineAtLogicalEndStable()
    ) {
      cancelTimelineLiveFollowForUserNavigationStable();
    }
  });
  useEffect(() => {
    const controller = createPageScrollController({
      getContainer: () => legendListRef.current?.getScrollableNode() ?? null,
      getScrollPaddingBottomPx: () => composerOverlayElement?.getBoundingClientRect().height ?? 0,
      onScrollStart: handlePageScrollStart,
    });
    pageScrollControllerRef.current = controller;

    return () => {
      controller.dispose();
      if (pageScrollControllerRef.current === controller) {
        pageScrollControllerRef.current = null;
      }
    };
  }, [composerOverlayElement, handlePageScrollStart, legendListRef]);
  const onComposerPageScrollKeyDown = (key: PageScrollKey) => {
    pageScrollControllerRef.current?.handleKeyDown(key);
  };
  const onComposerPageScrollKeyDownStable = useStableCallback(onComposerPageScrollKeyDown);
  const onComposerPageScrollKeyUp = (key: string) => {
    pageScrollControllerRef.current?.handleKeyUp(key);
  };
  const onComposerPageScrollKeyUpStable = useStableCallback(onComposerPageScrollKeyUp);
  const onComposerPageScrollRelease = () => {
    pageScrollControllerRef.current?.releaseActiveKey();
  };
  const onComposerPageScrollReleaseStable = useStableCallback(onComposerPageScrollRelease);
  const scrollToEnd = (animated: boolean = false) => {
    cancelPositionRestoreRef.current?.();
    isAtEndRef.current = true;
    timelineScrollModeRef.current = "following-end";
    liveFollowUserScrollGenerationRef.current = anchorUserScrollGenerationRef.current;
    setTimelineLiveFollowEnabled(true);
    pendingTimelineAnchorRef.current = null;
    activeTimelineAnchorIndexRef.current = null;
    showScrollDebouncer.current.cancel();
    setShowScrollToBottom(false);
    setTimelineAnchor(releaseChatTimelineAnchor);
    // The anchored end space must be gone before the scroll measures, or the
    // list lands short of the real end (#6519).
    requestAnimationFrame(() => {
      const list = legendListRef.current;
      if (!list) return;
      const releaseHold = viewportRef.current?.holdProgrammaticScroll();
      void Promise.resolve(list.scrollToEnd({ animated: animated && !prefersReducedMotion() }))
        .then(() =>
          settleListScroll(
            list,
            measuredEndOffset,
            () =>
              timelineScrollModeRef.current !== "following-end" || legendListRef.current !== list,
          ),
        )
        .finally(() => releaseHold?.());
    });
  };
  const scrollToEndStable = useStableCallback(scrollToEnd);
  const scrollConversation = (direction: 1 | -1) => {
    const node = legendListRef.current?.getScrollableNode();
    if (!(node instanceof HTMLElement)) return false;
    handlePageScrollStart(direction < 0 ? "PageUp" : "PageDown");
    node.scrollBy({
      top: direction * CONVERSATION_SCROLL_STEP_PX,
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  };
  const handleNavigation = useStableCallback((navigation: TimelineNavigation) => {
    if (navigation.source === "wheel" || navigation.source === "key") {
      timelineScrollIntentRef.current =
        navigation.direction === "down" ? "toward-end" : "away-from-end";
    }
    if (
      navigationReleasesFollow(navigation, {
        contentScrollsUp: timelineRealContentOverflowsViewportStable,
        awayFromEnd: () => resolveTimelineIsAtEnd(legendListRef.current?.getState()) === false,
      })
    ) {
      cancelTimelineLiveFollowForUserNavigationStable();
      viewportRef.current?.followReleased();
    }
  });
  const attachTimelineViewport = useStableCallback((viewport: TimelineViewport) => {
    viewportRef.current = viewport;
    const unsubscribe = viewport.subscribe(handleNavigation);
    return () => {
      unsubscribe();
      if (viewportRef.current === viewport) viewportRef.current = null;
    };
  });

  const onTimelineAnchorReady = (messageId: MessageId, anchorIndex: number) => {
    if (pendingTimelineAnchorRef.current === messageId) {
      pendingTimelineAnchorRef.current = null;
    }
    activeTimelineAnchorIndexRef.current = anchorIndex;
    if (positionedTimelineAnchorRef.current === messageId) {
      return;
    }
    positionedTimelineAnchorRef.current = messageId;
    settledTimelineAnchorRef.current = null;
    const releaseHold = viewportRef.current?.holdProgrammaticScroll();
    const positionAnchor = (remainingAttempts: number) => {
      requestAnimationFrame(() => {
        if (positionedTimelineAnchorRef.current !== messageId) {
          releaseHold?.();
          return;
        }
        const list = legendListRef.current;
        if (!list) {
          if (remainingAttempts > 0) {
            positionAnchor(remainingAttempts - 1);
          } else {
            releaseHold?.();
          }
          return;
        }
        void list
          .scrollToIndex({
            index: anchorIndex,
            animated: !prefersReducedMotion(),
            viewPosition: 0,
            viewOffset: CHAT_LIST_ANCHOR_OFFSET,
          })
          .then(() => {
            if (
              legendListRef.current === list &&
              positionedTimelineAnchorRef.current === messageId
            ) {
              settledTimelineAnchorRef.current = messageId;
            }
          })
          .finally(() => releaseHold?.());
      });
    };
    requestAnimationFrame(() => positionAnchor(12));
  };
  const onTimelineAnchorReadyStable = useStableCallback(onTimelineAnchorReady);
  const onTimelineAnchorSizeChanged = (messageId: MessageId) => {
    if (settledTimelineAnchorRef.current !== messageId) {
      return;
    }
    if (liveFollowUserScrollGenerationRef.current === anchorUserScrollGenerationRef.current) {
      return;
    }
    const scrollOffset = legendListRef.current?.getState().scroll;
    if (scrollOffset === undefined) {
      return;
    }
    if (pendingAnchorScrollRestoreRef.current === null) {
      pendingAnchorScrollRestoreRef.current = {
        messageId,
        offset: scrollOffset,
        userScrollGeneration: anchorUserScrollGenerationRef.current,
      };
    }
    if (anchorScrollRestoreFrameRef.current !== null) {
      return;
    }
    anchorScrollRestoreFrameRef.current = requestAnimationFrame(() => {
      anchorScrollRestoreFrameRef.current = null;
      const pending = pendingAnchorScrollRestoreRef.current;
      pendingAnchorScrollRestoreRef.current = null;
      if (
        pending &&
        settledTimelineAnchorRef.current === pending.messageId &&
        pending.userScrollGeneration === anchorUserScrollGenerationRef.current
      ) {
        const list = legendListRef.current;
        const currentScrollOffset = list?.getState().scroll;
        if (
          typeof currentScrollOffset === "number" &&
          Math.abs(currentScrollOffset - pending.offset) <= 2
        ) {
          void list?.scrollToOffset({ offset: pending.offset, animated: false });
        }
      }
    });
  };
  const onTimelineAnchorSizeChangedStable = useStableCallback(onTimelineAnchorSizeChanged);

  const onToolOutputCollapsedAtEnd = () => {};
  const onToolOutputCollapsedAtEndStable = useStableCallback(onToolOutputCollapsedAtEnd);

  const onIsAtEndChange = (isAtEnd: boolean) => {
    if (
      !isAtEnd &&
      liveFollowUserScrollGenerationRef.current === anchorUserScrollGenerationRef.current
    ) {
      showScrollDebouncer.current.cancel();
      setShowScrollToBottom(false);
      return;
    }
    if (isAtEndRef.current === isAtEnd) return;
    isAtEndRef.current = isAtEnd;
    if (isAtEnd) {
      if (timelineScrollIntentRef.current === "toward-end") {
      }
      timelineScrollModeRef.current = "following-end";
      liveFollowUserScrollGenerationRef.current = anchorUserScrollGenerationRef.current;
      setTimelineLiveFollowEnabled(true);
      setTimelineAnchor(releaseChatTimelineAnchor);
      showScrollDebouncer.current.cancel();
      setShowScrollToBottom(false);
    } else {
      timelineScrollModeRef.current = "free-scrolling";
      liveFollowUserScrollGenerationRef.current = null;
      showScrollDebouncer.current.maybeExecute();
    }
  };
  const onIsAtEndChangeStable = useStableCallback(onIsAtEndChange);

  // timelineEntries leave out reasoning rows (their text is not in the
  // structure), and reasoning counts as tool activity, like any work row.
  const runningTurnHasReasoning =
    activeRunningTurnId !== null &&
    serverProjection?.visibleTurnItems.some(
      (row) => row.item.type === "reasoning" && row.item.runId === activeRunningTurnId,
    ) === true;
  useLayoutEffect(() => {
    if (timelineScrollModeRef.current !== "anchoring-new-turn") return;
    if (
      (runningTurnHasReasoning && timelineAnchorMessageId !== null && timelineLiveFollowEnabled) ||
      shouldReleaseTimelineAnchorForToolActivity({
        anchorMessageId: timelineAnchorMessageId,
        liveFollowEnabled: timelineLiveFollowEnabled,
        runningTurnId: activeRunningTurnId,
        timelineEntries,
      })
    ) {
      scrollToEndStable();
    }
  }, [
    activeRunningTurnId,
    runningTurnHasReasoning,
    scrollToEndStable,
    timelineAnchorMessageId,
    timelineEntries,
    timelineLiveFollowEnabled,
  ]);

  const [timelineScrollSession, setTimelineScrollSession] = useState(() => ({
    threadKey: activeThreadKey,
    followEnd: readTimelinePosition(routeThreadKey)?.atEnd !== false,
  }));
  if (timelineScrollSession.threadKey !== activeThreadKey) {
    const followEnd = readTimelinePosition(routeThreadKey)?.atEnd !== false;
    setTimelineScrollSession({ threadKey: activeThreadKey, followEnd });
    setTimelineLiveFollowEnabled(followEnd);
    setShowScrollToBottom(!followEnd);
  }
  useEffect(() => {
    const { followEnd } = timelineScrollSession;
    isAtEndRef.current = followEnd;
    timelineScrollIntentRef.current = null;
    timelineScrollModeRef.current = followEnd ? "following-end" : "free-scrolling";
    liveFollowUserScrollGenerationRef.current = followEnd
      ? anchorUserScrollGenerationRef.current
      : null;
    pendingTimelineAnchorRef.current = null;
    positionedTimelineAnchorRef.current = null;
    settledTimelineAnchorRef.current = null;
    activeTimelineAnchorIndexRef.current = null;
    showScrollDebouncer.current.cancel();
  }, [timelineScrollSession]);

  /** Arms the anchor for a message the user just sent, before its run exists. */
  const anchorNewTurn = (threadKey: string, messageId: MessageId) => {
    isAtEndRef.current = true;
    timelineScrollModeRef.current = "anchoring-new-turn";
    liveFollowUserScrollGenerationRef.current = anchorUserScrollGenerationRef.current;
    setTimelineLiveFollowEnabled(true);
    pendingTimelineAnchorRef.current = messageId;
    activeTimelineAnchorIndexRef.current = null;
    showScrollDebouncer.current.cancel();
    setShowScrollToBottom(false);
    setTimelineAnchor({ threadKey, messageId });
  };

  // Codex Micro's conversation chords scroll the timeline a step at a time.
  const shortcuts = {
    "conversation.scrollUp": () => scrollConversation(-1),
    "conversation.scrollDown": () => scrollConversation(1),
    "conversation.scrollToEnd": () => scrollToEnd(true),
  } satisfies ChatShortcutCommands;

  return {
    shortcuts,
    attachTimelineViewport,
    showScrollToBottom,
    timelineLiveFollowEnabled,
    cancelPositionRestoreRef,
    isTimelineAtLogicalEndStable,
    cancelTimelineLiveFollowForUserNavigationStable,
    onComposerPageScrollKeyDownStable,
    onComposerPageScrollKeyUpStable,
    onComposerPageScrollReleaseStable,
    scrollToEnd,
    onTimelineAnchorReadyStable,
    onTimelineAnchorSizeChangedStable,
    onToolOutputCollapsedAtEndStable,
    onIsAtEndChangeStable,
    anchorNewTurn,
  };
}
