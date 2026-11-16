import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { observeResize } from "../lib/observeResize";

import { type HeightReveal, revealHeightChange } from "~/lib/layoutShift";
import { prefersReducedMotion } from "~/lib/motion";
import { cn } from "~/lib/utils";

const HEIGHT_TRANSITION_FALLBACK_MS = 250;

export function AnimatedHeight({
  children,
  holdHeight = false,
  animateKey,
}: {
  readonly children: ReactNode;
  readonly holdHeight?: boolean;
  /**
   * Animate only the resize that follows a change of this key, such as an
   * expanded flag. Every other resize, like a reflow at a new width, snaps.
   */
  readonly animateKey?: string | number | boolean;
}) {
  return animateKey === undefined ? (
    <TrackedHeight holdHeight={holdHeight}>{children}</TrackedHeight>
  ) : (
    <KeyedHeight animateKey={animateKey}>{children}</KeyedHeight>
  );
}

function TrackedHeight({
  children,
  holdHeight,
}: {
  readonly children: ReactNode;
  readonly holdHeight: boolean;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [heightState, setHeightState] = useState<{
    readonly height: number | null;
    readonly isClipping: boolean;
    readonly isShrinking: boolean;
  }>({ height: null, isClipping: false, isShrinking: false });

  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- fallback timer that ends clipping when the height transition never reports its end
  useEffect(() => {
    if (!heightState.isClipping) return;
    const clippedHeight = heightState.height;
    const timeoutId = window.setTimeout(() => {
      setHeightState((currentState) =>
        currentState.isClipping && currentState.height === clippedHeight
          ? { ...currentState, isClipping: false }
          : currentState,
      );
    }, HEIGHT_TRANSITION_FALLBACK_MS);
    return () => window.clearTimeout(timeoutId);
  }, [heightState.height, heightState.isClipping]);

  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- measures the content element and observes its size before paint to animate height
  useLayoutEffect(() => {
    if (holdHeight) return;
    const element = contentRef.current;
    if (!element) return;
    let firstFrameId: number | null = null;
    let secondFrameId: number | null = null;

    const updateHeight = () => {
      const nextHeight = Math.ceil(element.scrollHeight || element.getBoundingClientRect().height);
      setHeightState((currentState) => {
        if (currentState.height === nextHeight) return currentState;
        return {
          height: nextHeight,
          isClipping: currentState.height !== null,
          isShrinking: currentState.height !== null && nextHeight < currentState.height,
        };
      });
    };
    const cancelPendingFrames = () => {
      if (firstFrameId !== null) {
        window.cancelAnimationFrame(firstFrameId);
        firstFrameId = null;
      }
      if (secondFrameId !== null) {
        window.cancelAnimationFrame(secondFrameId);
        secondFrameId = null;
      }
    };
    const updateHeightAfterPaint = () => {
      cancelPendingFrames();
      updateHeight();
      firstFrameId = window.requestAnimationFrame(() => {
        firstFrameId = null;
        updateHeight();
        secondFrameId = window.requestAnimationFrame(() => {
          secondFrameId = null;
          updateHeight();
        });
      });
    };

    updateHeightAfterPaint();
    const stopObserving = observeResize(element, updateHeightAfterPaint);
    return () => {
      stopObserving();
      cancelPendingFrames();
    };
  }, [holdHeight]);

  return (
    <div
      data-slot="animated-height"
      className={cn(
        "transition-[height] duration-200 ease-drawer motion-reduce:transition-none [overflow-clip-margin:2px]",
        heightState.isShrinking && "duration-150",
      )}
      style={
        heightState.height === null
          ? undefined
          : {
              height: heightState.height,
              overflow: holdHeight || heightState.isClipping ? "clip" : "visible",
            }
      }
      onTransitionEnd={(event) => {
        if (event.target !== event.currentTarget || event.propertyName !== "height") return;
        setHeightState((currentState) =>
          currentState.isClipping ? { ...currentState, isClipping: false } : currentState,
        );
      }}
    >
      <div ref={contentRef} style={holdHeight ? { height: "100%" } : undefined}>
        {children}
      </div>
    </div>
  );
}

function KeyedHeight({
  children,
  animateKey,
}: {
  readonly children: ReactNode;
  readonly animateKey: string | number | boolean;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  // The layout effect below runs after the new content is in the DOM, so the
  // starting height comes from the last observed size.
  const lastHeightRef = useRef<number | null>(null);
  const revealRef = useRef<HeightReveal | null>(null);
  const animatedKeyRef = useRef(animateKey);

  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- observes the content's size to record the start height and cancels a running reveal on unmount
  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const stopObserving = observeResize(content, () => {
      lastHeightRef.current = content.offsetHeight;
    });
    return () => {
      stopObserving();
      revealRef.current?.stop();
    };
  }, []);

  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- starts the reveal on the wrapper before paint when the key changes
  useLayoutEffect(() => {
    if (animatedKeyRef.current === animateKey) return;
    animatedKeyRef.current = animateKey;
    const wrapper = wrapperRef.current;
    const content = contentRef.current;
    if (!wrapper || !content) return;
    const interrupted = revealRef.current?.stop() ?? null;
    revealRef.current = null;
    const from = interrupted?.visible ?? lastHeightRef.current;
    const laidOut = interrupted?.layout ?? lastHeightRef.current;
    const to = content.offsetHeight;
    if (from === null || laidOut === null || Math.abs(from - to) < 0.5 || prefersReducedMotion()) {
      return;
    }
    revealRef.current = revealHeightChange(wrapper, from, to, laidOut);
  }, [animateKey]);

  return (
    <div ref={wrapperRef}>
      <div ref={contentRef}>{children}</div>
    </div>
  );
}
