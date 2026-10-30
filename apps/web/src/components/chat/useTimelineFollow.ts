import {
  navigationReleasesFollow,
  type TimelineViewport,
  type TimelineNavigation,
} from "./timelineViewport";
import { measuredEndOffset, settleListScroll } from "./useTimelinePositionRestore";
import { useStableCallback } from "../../hooks/useStableCallback";
import { type MessageId, type RunId } from "@supaterm/contracts";
import { CHAT_LIST_ANCHOR_OFFSET } from "@supaterm/shared/chatList";
import { Debouncer } from "@tanstack/react-pacer";
import { useEffect, useLayoutEffect, useState } from "react";
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
import { shouldReleaseTimelineAnchorForToolActivity } from "../ChatView.logic";
import { prefersReducedMotion } from "../../lib/motion";
import type { Dispatch, RefObject, SetStateAction } from "react";
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
  readonly isServerThread: boolean;
  readonly serverProjection:
    | (Pick<ThreadStructure, "visibleTurnItems"> & {
        readonly runs: ReadonlyArray<
          Pick<ThreadStructure["runs"][number], "userMessageId" | "status">
        >;
      })
    | null;
  readonly threadStatus: EnvironmentThreadStatus;
  readonly activeActivityRun: Pick<
    NonNullable<ReturnType<typeof deriveThreadActivityRun>>,
    "runId" | "status"
  > | null;
  readonly activeRunningTurnId: RunId | null;
  readonly timelineEntries: ReadonlyArray<TimelineEntry>;
  readonly timelineAnchorMessageId?: MessageId | null;
  readonly setTimelineAnchor?: Dispatch<SetStateAction<TimelineAnchor>>;
}

type TimelineControllerEvent =
  | { readonly type: "show-scroll-button" }
  | { readonly type: "navigation"; readonly navigation: TimelineNavigation };

interface TimelineFollowController {
  isAtEnd: boolean;
  mode: TimelineScrollMode;
  userScrollGeneration: number;
  followScrollGeneration: number | null;
  positionedAnchor: MessageId | null;
  settledAnchor: MessageId | null;
  pendingScrollRestore: {
    readonly messageId: MessageId;
    readonly offset: number;
    readonly userScrollGeneration: number;
  } | null;
  scrollRestoreFrame: number | null;
  viewport: TimelineViewport | null;
  pageScroll: ReturnType<typeof createPageScrollController> | null;
  readonly cancelPositionRestore: { current: (() => void) | null };
  readonly showScrollDebouncer: Debouncer<() => void>;
  disposed: boolean;
  readonly frame: (callback: () => void) => number;
  readonly cancelFrame: (frame: number) => void;
  readonly holdScroll: () => (() => void) | undefined;
  readonly attachViewport: (viewport: TimelineViewport) => () => void;
  readonly activate: () => void;
  readonly subscribe: (listener: (event: TimelineControllerEvent) => void) => () => void;
  readonly cancelNavigation: () => boolean;
  readonly followEnd: () => void;
  readonly startAnchor: () => void;
  readonly positionAnchor: (messageId: MessageId) => boolean;
  readonly settleAnchor: (messageId: MessageId) => void;
  readonly ownPageScroll: (pageScroll: ReturnType<typeof createPageScrollController>) => () => void;
  readonly updateAtEnd: (
    isAtEnd: boolean,
  ) => "hide-button" | "unchanged" | "following-end" | "free-scrolling";
  readonly restoreAnchorAfterResize: (
    messageId: MessageId,
    listRef: RefObject<LegendListRef | null>,
  ) => void;
  readonly dispose: () => void;
}

interface TimelineFollowState {
  readonly ownerKey: string;
  readonly controller: TimelineFollowController;
  readonly observation: TimelineRunObservation | null;
  readonly anchor: TimelineAnchor;
  readonly pendingAnchor: MessageId | null;
  readonly liveFollowEnabled: boolean;
  readonly showScrollToBottom: boolean;
}

function createTimelineFollowController(followsEnd: boolean): TimelineFollowController {
  const listeners = new Set<(event: TimelineControllerEvent) => void>();
  const emit = (event: TimelineControllerEvent) => {
    for (const listener of listeners) listener(event);
  };
  const frames = new Set<number>();
  const holds = new Set<() => void>();
  const subscriptions = new Set<() => void>();
  const controller: TimelineFollowController = {
    isAtEnd: followsEnd,
    mode: followsEnd ? "following-end" : "free-scrolling",
    userScrollGeneration: 0,
    followScrollGeneration: followsEnd ? 0 : null,
    positionedAnchor: null,
    settledAnchor: null,
    pendingScrollRestore: null,
    scrollRestoreFrame: null,
    viewport: null,
    pageScroll: null,
    cancelPositionRestore: { current: null },
    showScrollDebouncer: new Debouncer(() => emit({ type: "show-scroll-button" }), { wait: 150 }),
    disposed: false,
    frame(callback) {
      if (controller.disposed) return 0;
      const frame = requestAnimationFrame(() => {
        frames.delete(frame);
        if (!controller.disposed) callback();
      });
      frames.add(frame);
      return frame;
    },
    cancelFrame(frame) {
      frames.delete(frame);
      cancelAnimationFrame(frame);
    },
    holdScroll() {
      const releaseHold = controller.viewport?.holdProgrammaticScroll();
      if (!releaseHold) return;
      const release = () => {
        if (holds.delete(release)) releaseHold();
      };
      holds.add(release);
      return release;
    },
    attachViewport(viewport) {
      controller.viewport = viewport;
      const unsubscribe = viewport.subscribe((navigation) => {
        if (!controller.disposed) emit({ type: "navigation", navigation });
      });
      const detach = () => {
        unsubscribe();
        subscriptions.delete(detach);
        if (controller.viewport === viewport) controller.viewport = null;
      };
      subscriptions.add(detach);
      return detach;
    },
    activate() {
      controller.disposed = false;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    cancelNavigation() {
      controller.userScrollGeneration += 1;
      const wasProgrammatic = controller.mode !== "free-scrolling";
      controller.mode = "free-scrolling";
      controller.followScrollGeneration = null;
      controller.positionedAnchor = null;
      controller.settledAnchor = null;
      controller.pendingScrollRestore = null;
      if (controller.scrollRestoreFrame !== null) {
        controller.cancelFrame(controller.scrollRestoreFrame);
        controller.scrollRestoreFrame = null;
      }
      return wasProgrammatic;
    },
    followEnd() {
      controller.isAtEnd = true;
      controller.mode = "following-end";
      controller.followScrollGeneration = controller.userScrollGeneration;
      controller.showScrollDebouncer.cancel();
    },
    startAnchor() {
      controller.isAtEnd = true;
      controller.mode = "anchoring-new-turn";
      controller.followScrollGeneration = controller.userScrollGeneration;
      controller.showScrollDebouncer.cancel();
    },
    positionAnchor(messageId) {
      controller.startAnchor();
      if (controller.positionedAnchor === messageId) return false;
      controller.positionedAnchor = messageId;
      controller.settledAnchor = null;
      return true;
    },
    settleAnchor(messageId) {
      if (!controller.disposed && controller.positionedAnchor === messageId)
        controller.settledAnchor = messageId;
    },
    ownPageScroll(pageScroll) {
      controller.pageScroll = pageScroll;
      return () => {
        pageScroll.dispose();
        if (controller.pageScroll === pageScroll) controller.pageScroll = null;
      };
    },
    updateAtEnd(isAtEnd) {
      if (!isAtEnd && controller.followScrollGeneration === controller.userScrollGeneration) {
        controller.showScrollDebouncer.cancel();
        return "hide-button";
      }
      if (controller.isAtEnd === isAtEnd) return "unchanged";
      controller.isAtEnd = isAtEnd;
      if (isAtEnd) {
        controller.followEnd();
        return "following-end";
      }
      controller.mode = "free-scrolling";
      controller.followScrollGeneration = null;
      controller.showScrollDebouncer.maybeExecute();
      return "free-scrolling";
    },
    restoreAnchorAfterResize(messageId, listRef) {
      if (controller.disposed) return;
      if (controller.settledAnchor !== messageId) {
        return;
      }
      if (controller.followScrollGeneration === controller.userScrollGeneration) {
        return;
      }
      const scrollOffset = listRef.current?.getState().scroll;
      if (scrollOffset === undefined) {
        return;
      }
      if (controller.pendingScrollRestore === null) {
        controller.pendingScrollRestore = {
          messageId,
          offset: scrollOffset,
          userScrollGeneration: controller.userScrollGeneration,
        };
      }
      if (controller.scrollRestoreFrame !== null) {
        return;
      }
      controller.scrollRestoreFrame = controller.frame(() => {
        controller.scrollRestoreFrame = null;
        const pending = controller.pendingScrollRestore;
        controller.pendingScrollRestore = null;
        if (
          pending &&
          controller.settledAnchor === pending.messageId &&
          pending.userScrollGeneration === controller.userScrollGeneration
        ) {
          const list = listRef.current;
          const currentScrollOffset = list?.getState().scroll;
          if (
            typeof currentScrollOffset === "number" &&
            Math.abs(currentScrollOffset - pending.offset) <= 2
          ) {
            void list?.scrollToOffset({ offset: pending.offset, animated: false });
          }
        }
      });
    },
    dispose() {
      controller.disposed = true;
      controller.showScrollDebouncer.cancel();
      for (const frame of frames) cancelAnimationFrame(frame);
      frames.clear();
      for (const release of holds) release();
      for (const detach of subscriptions) detach();
      controller.pageScroll?.dispose();
      controller.pageScroll = null;
      controller.cancelPositionRestore.current?.();
      controller.cancelPositionRestore.current = null;
    },
  };
  return controller;
}

/**
 * Keeps the timeline following the live end, anchoring a newly sent turn near
 * the top, and letting the user scroll away. The scroll handlers own a controller, so
 * a scroll gesture does not re-render ChatView unless the follow mode flips.
 * A thread opens at its remembered reading position.
 */
export function useTimelineFollow(input: TimelineFollowInput) {
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
  } = input;
  const ownerKey = activeThreadKey ?? routeThreadKey;
  const createState = (): TimelineFollowState => {
    const followsEnd = readTimelinePosition(routeThreadKey)?.atEnd !== false;
    const controller = createTimelineFollowController(followsEnd);
    return {
      ownerKey,
      controller,
      observation: null,
      anchor: { threadKey: activeThreadKey, messageId: null },
      pendingAnchor: null,
      liveFollowEnabled: followsEnd,
      showScrollToBottom: !followsEnd,
    };
  };
  const [storedState, setFollowState] = useState(createState);
  let state = storedState;
  if (state.ownerKey !== ownerKey) {
    const next = createState();
    state =
      state.anchor.threadKey === activeThreadKey && state.anchor.messageId !== null
        ? { ...next, anchor: state.anchor, pendingAnchor: state.pendingAnchor }
        : next;
    setFollowState(state);
  }
  const previous = state.observation;
  const dispatchedUserItem =
    previous?.hydrated &&
    previous.threadKey === activeThreadKey &&
    activeActivityRun !== null &&
    previous.runId !== activeActivityRun.runId
      ? serverProjection?.visibleTurnItems.find(
          (row) => row.item.type === "user_message" && row.item.runId === activeActivityRun.runId,
        )
      : undefined;
  const { observation, anchorMessageId } = observeTimelineRun(previous, {
    threadKey: activeThreadKey,
    hydrated: !isServerThread || (serverProjection !== null && threadStatus === "live"),
    runId: activeActivityRun?.runId ?? null,
    queued: activeActivityRun?.status === "queued",
    messageId:
      dispatchedUserItem?.item.type === "user_message" ? dispatchedUserItem.item.messageId : null,
  });
  if (
    previous?.threadKey !== observation.threadKey ||
    previous?.hydrated !== observation.hydrated ||
    previous?.runId !== observation.runId
  ) {
    const anchor =
      anchorMessageId !== null && state.pendingAnchor === null && state.liveFollowEnabled;
    state = {
      ...state,
      observation,
      ...(anchor
        ? {
            anchor: { threadKey: activeThreadKey, messageId: anchorMessageId },
            pendingAnchor: anchorMessageId,
            showScrollToBottom: false,
          }
        : {}),
    };
    setFollowState(state);
    if (anchor) input.setTimelineAnchor?.(state.anchor);
  }
  const anchorRun =
    state.anchor.messageId === null
      ? undefined
      : serverProjection?.runs.find((run) => run.userMessageId === state.anchor.messageId);
  if (
    anchorRun &&
    anchorRun.status !== "preparing" &&
    anchorRun.status !== "queued" &&
    anchorRun.status !== "starting" &&
    anchorRun.status !== "running" &&
    anchorRun.status !== "waiting"
  ) {
    state = {
      ...state,
      anchor: { threadKey: activeThreadKey, messageId: null },
      pendingAnchor: null,
    };
    setFollowState(state);
  }
  const { controller, showScrollToBottom, liveFollowEnabled: timelineLiveFollowEnabled } = state;
  const timelineAnchorMessageId = input.setTimelineAnchor
    ? (input.timelineAnchorMessageId ?? null)
    : state.anchor.messageId;
  const updateState = (update: (current: TimelineFollowState) => TimelineFollowState) => {
    setFollowState((current) => (current.controller === controller ? update(current) : current));
  };
  const setShowScrollToBottom = (show: boolean) =>
    updateState((current) =>
      current.showScrollToBottom === show ? current : { ...current, showScrollToBottom: show },
    );
  const resumeFollow = () => {
    controller.followEnd();
    updateState((current) => ({
      ...current,
      anchor: { threadKey: activeThreadKey, messageId: null },
      pendingAnchor: null,
      liveFollowEnabled: true,
      showScrollToBottom: false,
    }));
    input.setTimelineAnchor?.({ threadKey: activeThreadKey, messageId: null });
  };
  const isTimelineAtLogicalEnd = () =>
    resolveTimelineIsAtEnd(legendListRef.current?.getState()) ?? controller.isAtEnd;
  const isTimelineAtLogicalEndStable = useStableCallback(isTimelineAtLogicalEnd);
  const cancelTimelineLiveFollowForUserNavigation = () => {
    if (controller.disposed) return;
    controller.cancelPositionRestore.current?.();
    const wasProgrammaticScrollMode = controller.cancelNavigation();
    updateState((current) => ({ ...current, liveFollowEnabled: false, pendingAnchor: null }));
    if (wasProgrammaticScrollMode) {
      // An absent item cancels LegendList's pending imperative scrolls without
      // moving the viewport after the user takes over.
      void legendListRef.current?.scrollToItem({
        item: TIMELINE_SCROLL_CANCEL_SENTINEL,
        animated: false,
      });
      // An already-started animated scroll (behavior: smooth) keeps running in
      // the browser regardless of the queue; a same-position instant write is
      // the only way to halt it where it is.
      const scrollNode = legendListRef.current?.getScrollableNode();
      const currentScrollTop = scrollNode?.scrollTop;
      if (scrollNode && typeof currentScrollTop === "number") {
        scrollNode.scrollTop = currentScrollTop;
      }
    }
  };
  const cancelTimelineLiveFollowForUserNavigationStable = useStableCallback(
    cancelTimelineLiveFollowForUserNavigation,
  );

  const timelineRealContentOverflowsViewport = (list?: LegendListRef | null) =>
    timelineContentOverflowsViewport((list ?? legendListRef.current)?.getState(), {
      composerInset: composerTimelineInset,
      anchorOffset: CHAT_TIMELINE_ANCHOR_OFFSET,
    });
  const timelineRealContentOverflowsViewportStable = useStableCallback(
    timelineRealContentOverflowsViewport,
  );
  const handlePageScrollStart = useStableCallback((key: PageScrollKey) => {
    if (
      (key === "PageUp" && timelineRealContentOverflowsViewportStable()) ||
      !isTimelineAtLogicalEndStable()
    ) {
      cancelTimelineLiveFollowForUserNavigationStable();
    }
  });
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- Own the page-scroll controller's animation frames and hold timer for this mounted viewport, disposing them on cleanup.
  useEffect(() => {
    const pageScroll = createPageScrollController({
      getContainer: () => legendListRef.current?.getScrollableNode() ?? null,
      getScrollPaddingBottomPx: () => composerOverlayElement?.getBoundingClientRect().height ?? 0,
      onScrollStart: handlePageScrollStart,
    });
    return controller.ownPageScroll(pageScroll);
  }, [composerOverlayElement, controller, handlePageScrollStart, legendListRef]);
  const onComposerPageScrollKeyDown = (key: PageScrollKey) => {
    controller.pageScroll?.handleKeyDown(key);
  };
  const onComposerPageScrollKeyDownStable = useStableCallback(onComposerPageScrollKeyDown);
  const onComposerPageScrollKeyUp = (key: string) => {
    controller.pageScroll?.handleKeyUp(key);
  };
  const onComposerPageScrollKeyUpStable = useStableCallback(onComposerPageScrollKeyUp);
  const onComposerPageScrollRelease = () => {
    controller.pageScroll?.releaseActiveKey();
  };
  const onComposerPageScrollReleaseStable = useStableCallback(onComposerPageScrollRelease);
  const scrollToEnd = (animated: boolean = false) => {
    if (controller.disposed) return;
    controller.cancelPositionRestore.current?.();
    resumeFollow();
    // Remove the anchor spacer before measuring the real end.
    controller.frame(() => {
      if (controller.mode !== "following-end") return;
      const list = legendListRef.current;
      if (!list) return;
      const releaseHold = controller.holdScroll();
      void Promise.resolve(list.scrollToEnd({ animated: animated && !prefersReducedMotion() }))
        .then(() =>
          settleListScroll(
            list,
            measuredEndOffset,
            () =>
              controller.disposed ||
              controller.mode !== "following-end" ||
              legendListRef.current !== list,
          ),
        )
        .finally(() => releaseHold?.());
    });
  };
  const scrollToEndStable = useStableCallback(scrollToEnd);
  const onTimelineFooterGrowStable = useStableCallback(() => {
    if (controller.mode === "following-end" && state.pendingAnchor === null) scrollToEndStable();
  });
  const scrollConversation = (direction: 1 | -1) => {
    const node = legendListRef.current?.getScrollableNode();
    if (!(node instanceof HTMLElement)) return false;
    handlePageScrollStart(direction < 0 ? "PageUp" : "PageDown");
    node.scrollBy({
      top: direction * CONVERSATION_SCROLL_STEP_PX,
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  };
  const handleNavigation = useStableCallback(
    (owner: TimelineFollowController, navigation: TimelineNavigation) => {
      if (owner !== controller) return;
      if (
        navigationReleasesFollow(navigation, {
          contentScrollsUp: timelineRealContentOverflowsViewportStable,
          awayFromEnd: () => resolveTimelineIsAtEnd(legendListRef.current?.getState()) === false,
        })
      ) {
        cancelTimelineLiveFollowForUserNavigationStable();
        controller.viewport?.followReleased();
      }
    },
  );

  const onControllerEvent = useStableCallback(
    (owner: TimelineFollowController, event: TimelineControllerEvent) => {
      if (owner !== controller) return;
      if (event.type === "show-scroll-button") setShowScrollToBottom(true);
      else handleNavigation(owner, event.navigation);
    },
  );
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- Subscribe to this thread's viewport and timer events; dispose its listeners, holds, and pending scroll frames with the controller.
  useLayoutEffect(() => {
    controller.activate();
    const unsubscribe = controller.subscribe((event) => onControllerEvent(controller, event));
    return () => {
      unsubscribe();
      controller.dispose();
    };
  }, [controller, onControllerEvent]);

  const onTimelineAnchorReady = (messageId: MessageId, anchorIndex: number) => {
    if (controller.disposed) return;
    if (messageId !== timelineAnchorMessageId || !state.liveFollowEnabled) return;
    updateState((current) =>
      current.pendingAnchor === messageId ? { ...current, pendingAnchor: null } : current,
    );
    if (!controller.positionAnchor(messageId)) return;
    const releaseHold = controller.holdScroll();
    const positionAnchor = (remainingAttempts: number) => {
      controller.frame(() => {
        if (controller.disposed || controller.positionedAnchor !== messageId) {
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
              !controller.disposed &&
              legendListRef.current === list &&
              controller.positionedAnchor === messageId
            ) {
              controller.settleAnchor(messageId);
            }
          })
          .finally(() => releaseHold?.());
      });
    };
    controller.frame(() => positionAnchor(12));
  };
  const onTimelineAnchorReadyStable = useStableCallback(onTimelineAnchorReady);
  const onTimelineAnchorSizeChanged = (messageId: MessageId) => {
    if (!controller.disposed) controller.restoreAnchorAfterResize(messageId, legendListRef);
  };
  const onTimelineAnchorSizeChangedStable = useStableCallback(onTimelineAnchorSizeChanged);

  const onToolOutputCollapsedAtEnd = () => {};
  const onToolOutputCollapsedAtEndStable = useStableCallback(onToolOutputCollapsedAtEnd);

  const onIsAtEndChange = (isAtEnd: boolean) => {
    if (controller.disposed) return;
    const result = controller.updateAtEnd(isAtEnd);
    if (result === "hide-button") setShowScrollToBottom(false);
    if (result === "following-end") resumeFollow();
  };
  const onIsAtEndChangeStable = useStableCallback(onIsAtEndChange);

  // timelineEntries leave out reasoning rows (their text is not in the
  // structure), and reasoning counts as tool activity, like any work row.
  const runningTurnHasReasoning =
    activeRunningTurnId !== null &&
    serverProjection?.visibleTurnItems.some(
      (row) => row.item.type === "reasoning" && row.item.runId === activeRunningTurnId,
    ) === true;
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- Scroll the mounted viewport to its live end once tool activity replaces the new-turn anchor.
  useLayoutEffect(() => {
    if (controller.mode !== "anchoring-new-turn" && state.pendingAnchor === null) return;
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
    controller,
    state.pendingAnchor,
  ]);

  /** Arms the anchor for a message the user just sent, before its run exists. */
  const anchorNewTurn = (threadKey: string, messageId: MessageId) => {
    if (controller.disposed) return;
    controller.startAnchor();
    input.setTimelineAnchor?.({ threadKey, messageId });
    updateState((current) => ({
      ...current,
      anchor: { threadKey, messageId },
      pendingAnchor: messageId,
      liveFollowEnabled: true,
      showScrollToBottom: false,
    }));
  };

  // Codex Micro's conversation chords scroll the timeline a step at a time.
  const shortcuts = {
    "conversation.scrollUp": () => scrollConversation(-1),
    "conversation.scrollDown": () => scrollConversation(1),
    "conversation.scrollToEnd": () => scrollToEnd(true),
  } satisfies ChatShortcutCommands;

  return {
    shortcuts,
    attachTimelineViewport: controller.attachViewport,
    showScrollToBottom,
    timelineLiveFollowEnabled,
    timelineAnchorMessageId,
    cancelPositionRestoreRef: controller.cancelPositionRestore,
    isTimelineAtLogicalEndStable,
    cancelTimelineLiveFollowForUserNavigationStable,
    onComposerPageScrollKeyDownStable,
    onComposerPageScrollKeyUpStable,
    onComposerPageScrollReleaseStable,
    scrollToEnd,
    onTimelineAnchorReadyStable,
    onTimelineAnchorSizeChangedStable,
    onToolOutputCollapsedAtEndStable,
    onTimelineFooterGrowStable,
    onIsAtEndChangeStable,
    anchorNewTurn,
  };
}
