import {
  eventPathContainsSelector,
  TYPE_TO_FOCUS_EDITABLE_SELECTOR,
  TYPE_TO_FOCUS_FLOATING_LAYER_SELECTOR,
} from "./composerFocusRedirect";
import { resolveTimelineIsAtEnd } from "./MessagesTimeline.logic";
import { createUpwardScrollDetector, isTimelineScrollTarget } from "./timelineScrollTarget";

export type TimelineScrollDirection = "up" | "down";

export type TimelineNavigation =
  | { readonly source: "wheel"; readonly direction: TimelineScrollDirection }
  | { readonly source: "touch" }
  | { readonly source: "pointer"; readonly onScrollbar: boolean }
  | { readonly source: "key"; readonly key: string; readonly direction: TimelineScrollDirection }
  | { readonly source: "scroll" }
  | { readonly source: "command"; readonly releasesFollow: boolean };

export interface TimelineViewport {
  readonly scrollNode: HTMLElement;
  readonly subscribe: (listener: (navigation: TimelineNavigation) => void) => () => void;
  readonly navigate: (options: { readonly releasesFollow: boolean }) => void;
  readonly holdProgrammaticScroll: () => () => void;
  readonly followReleased: () => void;
  readonly onFollowReleased: (listener: () => void) => () => void;
}

const UP_KEYS = new Set(["PageUp", "Home", "ArrowUp"]);
const DOWN_KEYS = new Set(["PageDown", "End", "ArrowDown", " "]);

export function attachTimelineViewport(
  scrollNode: HTMLElement,
  isInputOwner: () => boolean = () => true,
): TimelineViewport & {
  readonly dispose: () => void;
} {
  const listeners = new Set<(navigation: TimelineNavigation) => void>();
  const followReleasedListeners = new Set<() => void>();
  let programmaticHolds = 0;
  const emit = (navigation: TimelineNavigation) => {
    for (const listener of listeners) listener(navigation);
  };
  const handleWheel = (event: WheelEvent) => {
    if (event.ctrlKey || !isTimelineScrollTarget(event.target, scrollNode, event.deltaY)) return;
    emit({ source: "wheel", direction: event.deltaY < 0 ? "up" : "down" });
  };
  const handleTouchMove = () => emit({ source: "touch" });
  const handlePointerDown = (event: PointerEvent) =>
    emit({ source: "pointer", onScrollbar: event.target === scrollNode });
  const handleKeyDown = (event: KeyboardEvent) => {
    const direction = UP_KEYS.has(event.key) ? "up" : DOWN_KEYS.has(event.key) ? "down" : null;
    if (
      direction === null ||
      event.defaultPrevented ||
      !(event.target instanceof Node) ||
      (!scrollNode.contains(event.target) &&
        event.target !== document.body &&
        event.target !== document.documentElement) ||
      (!scrollNode.contains(event.target) && !isInputOwner()) ||
      event.isComposing ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      eventPathContainsSelector(event, TYPE_TO_FOCUS_EDITABLE_SELECTOR) ||
      document.querySelector(TYPE_TO_FOCUS_FLOATING_LAYER_SELECTOR) ||
      (scrollNode.contains(event.target) &&
        !isTimelineScrollTarget(event.target, scrollNode, direction === "up" ? -1 : 1))
    ) {
      return;
    }
    emit({ source: "key", key: event.key, direction });
  };
  const scrolledUp = createUpwardScrollDetector({
    top: scrollNode.scrollTop,
    height: scrollNode.scrollHeight,
  });
  const handleScroll = () => {
    if (
      scrolledUp({
        top: scrollNode.scrollTop,
        height: scrollNode.scrollHeight,
        programmatic: programmaticHolds > 0,
      }) &&
      resolveTimelineIsAtEnd({
        contentLength: scrollNode.scrollHeight,
        scroll: scrollNode.scrollTop,
        scrollLength: scrollNode.clientHeight,
      }) === false
    ) {
      emit({ source: "scroll" });
    }
  };
  scrollNode.addEventListener("scroll", handleScroll, { passive: true });
  scrollNode.addEventListener("wheel", handleWheel, { passive: true });
  scrollNode.addEventListener("touchmove", handleTouchMove, { passive: true });
  scrollNode.addEventListener("pointerdown", handlePointerDown, { passive: true });
  scrollNode.ownerDocument.addEventListener("keydown", handleKeyDown);
  return {
    scrollNode,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    navigate: ({ releasesFollow }) => emit({ source: "command", releasesFollow }),
    holdProgrammaticScroll: () => {
      programmaticHolds += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        programmaticHolds -= 1;
      };
    },
    followReleased: () => {
      for (const listener of followReleasedListeners) listener();
    },
    onFollowReleased: (listener) => {
      followReleasedListeners.add(listener);
      return () => followReleasedListeners.delete(listener);
    },
    dispose: () => {
      listeners.clear();
      followReleasedListeners.clear();
      scrollNode.removeEventListener("scroll", handleScroll);
      scrollNode.removeEventListener("wheel", handleWheel);
      scrollNode.removeEventListener("touchmove", handleTouchMove);
      scrollNode.removeEventListener("pointerdown", handlePointerDown);
      scrollNode.ownerDocument.removeEventListener("keydown", handleKeyDown);
    },
  };
}

export function navigationReleasesFollow(
  navigation: TimelineNavigation,
  viewport: { readonly contentScrollsUp: () => boolean; readonly awayFromEnd: () => boolean },
): boolean {
  switch (navigation.source) {
    case "wheel":
      return navigation.direction === "up" && viewport.contentScrollsUp();
    case "key":
      return navigation.direction === "up" ? viewport.contentScrollsUp() : viewport.awayFromEnd();
    case "pointer":
      return navigation.onScrollbar ? viewport.contentScrollsUp() : viewport.awayFromEnd();
    case "touch":
      return viewport.awayFromEnd();
    case "scroll":
      return true;
    case "command":
      return navigation.releasesFollow;
  }
}
