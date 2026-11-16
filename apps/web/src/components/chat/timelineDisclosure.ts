import { createContext, use, useState } from "react";

/**
 * Reports a disclosure toggle inside a messages-timeline row so the list holds
 * still while that row resizes. Call it before flipping the open state, with
 * the toggle's event target and whether the toggle closes.
 */
export type TimelineDisclosureToggle = (target: EventTarget | null, closing: boolean) => void;

export const TimelineDisclosureContext = createContext<TimelineDisclosureToggle>(() => {});

export function useTimelineDisclosureToggle() {
  return use(TimelineDisclosureContext);
}

/** Open state for a disclosure in a timeline row; `toggle` reports itself to the list first. */
export function useTimelineDisclosure(initialOpen = false) {
  const report = useTimelineDisclosureToggle();
  const [open, setOpen] = useState(initialOpen);
  const toggle = (event: { readonly target: EventTarget | null }) => {
    report(event.target, open);
    setOpen(!open);
  };
  return [open, toggle, setOpen] as const;
}

// Base UI starts a panel's height transition a frame after the toggle commits.
const MIN_SETTLE_FRAMES = 3;
const MAX_SETTLE_MS = 1000;

/**
 * Calls `onSettled` once the toggled row stops resizing: no height animation
 * runs inside it and its measured size held for a frame. A row that never
 * settles is released after a second. Returns a cancel function.
 */
export function waitForDisclosureSettle(
  measure: () => {
    readonly size: number | undefined;
    readonly element: Element | null | undefined;
  } | null,
  onSettled: () => void,
): () => void {
  const startedAt = performance.now();
  let frames = 0;
  let previousSize: number | undefined;
  let frame = requestAnimationFrame(function check() {
    frames += 1;
    const row = measure();
    const resizing = row?.size !== previousSize || hasHeightAnimation(row?.element);
    previousSize = row?.size;
    const settled = frames >= MIN_SETTLE_FRAMES && !resizing;
    const timedOut = performance.now() - startedAt >= MAX_SETTLE_MS;
    if (settled || timedOut) {
      onSettled();
      return;
    }
    frame = requestAnimationFrame(check);
  });
  return () => cancelAnimationFrame(frame);
}

function hasHeightAnimation(element: Element | null | undefined) {
  return element?.getAnimations({ subtree: true }).some(animatesHeight) ?? false;
}

function animatesHeight(animation: Animation) {
  if ("transitionProperty" in animation) {
    return (
      animation.transitionProperty === "height" ||
      animation.transitionProperty === "grid-template-rows"
    );
  }
  return (
    animation.effect instanceof KeyframeEffect &&
    animation.effect.getKeyframes().some((keyframe) => "height" in keyframe)
  );
}
