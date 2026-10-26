import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { observeResize } from "../lib/observeResize";

import { EASE_DRAWER, prefersReducedMotion } from "~/lib/motion";
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
  const animationRef = useRef<Animation | null>(null);
  const animatedKeyRef = useRef(animateKey);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const stopObserving = observeResize(content, () => {
      lastHeightRef.current = content.offsetHeight;
    });
    return () => {
      stopObserving();
      animationRef.current?.cancel();
    };
  }, []);

  useLayoutEffect(() => {
    if (animatedKeyRef.current === animateKey) return;
    animatedKeyRef.current = animateKey;
    const wrapper = wrapperRef.current;
    const content = contentRef.current;
    if (!wrapper || !content) return;
    const running = animationRef.current;
    const from = running ? wrapper.getBoundingClientRect().height : lastHeightRef.current;
    running?.cancel();
    animationRef.current = null;
    const to = content.offsetHeight;
    if (from === null || from === to || prefersReducedMotion()) {
      wrapper.style.removeProperty("overflow");
      return;
    }
    wrapper.style.overflow = "clip";
    const animation = wrapper.animate(
      { height: [`${from}px`, `${to}px`] },
      { duration: to > from ? 200 : 150, easing: EASE_DRAWER },
    );
    animation.onfinish = () => {
      animationRef.current = null;
      wrapper.style.removeProperty("overflow");
    };
    animationRef.current = animation;
  }, [animateKey]);

  return (
    <div ref={wrapperRef} className="[overflow-clip-margin:2px]">
      <div ref={contentRef}>{children}</div>
    </div>
  );
}
