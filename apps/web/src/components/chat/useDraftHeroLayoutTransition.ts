import { useLayoutEffect, useRef } from "react";
import { EASE_DRAWER } from "../../lib/motion";
import { DRAFT_HERO_TRANSITION_ANIMATION_ID } from "./draftHeroTransition";

// Measures the prompt surface, not its anchor: the hero's context strip above it
// and a thread's strip below it come and go with the state change.
function measureComposerSurface(anchor: HTMLElement | null): DOMRect | null {
  const surface = anchor?.querySelector('[data-chat-composer-main-surface="true"]') ?? anchor;
  return surface?.getBoundingClientRect() ?? null;
}

export function useDraftHeroLayoutTransition(
  isDraftHeroState: boolean,
  animationsActive: boolean,
  animationDurationMs: number,
) {
  const transitionGroupRef = useRef<HTMLDivElement | null>(null);
  const composerAnchorRef = useRef<HTMLDivElement | null>(null);
  const previousStateRef = useRef(isDraftHeroState);
  const previousComposerRectRef = useRef<DOMRect | null>(null);
  const animationRef = useRef<Animation | null>(null);
  const attachTransitionGroupRef = (element: HTMLDivElement | null) => {
    transitionGroupRef.current = element;
  };
  const attachComposerAnchorRef = (element: HTMLDivElement | null) => {
    composerAnchorRef.current = element;
  };

  const captureLayout = () => {
    previousComposerRectRef.current = measureComposerSurface(composerAnchorRef.current);
  };

  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- Measures committed composer geometry and drives its Web Animation before paint.
  useLayoutEffect(() => {
    const transitionGroup = transitionGroupRef.current;
    const nextComposerRect = measureComposerSurface(composerAnchorRef.current);
    const stateChanged = previousStateRef.current !== isDraftHeroState;
    const mobileComposerTransitionActive =
      typeof document !== "undefined" &&
      document.documentElement.dataset.mobileComposerRouteTransition === "true";

    animationRef.current?.cancel();
    animationRef.current = null;
    const previousComposerRect = previousComposerRectRef.current;
    if (
      stateChanged &&
      animationsActive &&
      !mobileComposerTransitionActive &&
      transitionGroup &&
      previousComposerRect &&
      nextComposerRect &&
      typeof transitionGroup.animate === "function"
    ) {
      const translateX = previousComposerRect.left - nextComposerRect.left;
      const translateY = previousComposerRect.top - nextComposerRect.top;
      if (Math.abs(translateX) >= 0.5 || Math.abs(translateY) >= 0.5) {
        const animation = transitionGroup.animate(
          [
            { transform: `translate3d(${translateX}px, ${translateY}px, 0)` },
            { transform: "translate3d(0, 0, 0)" },
          ],
          {
            duration: animationDurationMs,
            easing: EASE_DRAWER,
          },
        );
        animation.id = DRAFT_HERO_TRANSITION_ANIMATION_ID;
        animationRef.current = animation;
        void animation.finished
          .catch(() => undefined)
          .then(() => {
            if (animationRef.current === animation) animationRef.current = null;
          });
      }
    }
    previousStateRef.current = isDraftHeroState;
    previousComposerRectRef.current = nextComposerRect;
  }, [animationDurationMs, animationsActive, isDraftHeroState]);

  return {
    transitionGroupRef: attachTransitionGroupRef,
    composerAnchorRef: attachComposerAnchorRef,
    captureLayout,
  } as const;
}
