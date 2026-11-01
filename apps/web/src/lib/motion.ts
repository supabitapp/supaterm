/** WAAPI twins of the `--ease-drawer` theme token in index.css and Tailwind's `--ease-in`. */
export const EASE_DRAWER = "cubic-bezier(0.32, 0.72, 0, 1)";
export const EASE_IN = "cubic-bezier(0.4, 0, 1, 1)";

export function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Resolves once the element's running finite animations end, finished or
 * cancelled. Looping animations (spinners, shimmer) are ignored so they never
 * hold an exit open.
 */
export function animationsSettled(element: Element, options?: GetAnimationsOptions) {
  const finite = element
    .getAnimations(options)
    .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity);
  return Promise.allSettled(finite.map((animation) => animation.finished)).then(() => undefined);
}

export function runningSizeAnimation(
  element: Element,
  options?: GetAnimationsOptions,
): Animation | undefined {
  return element
    .getAnimations(options)
    .find(
      (animation) =>
        animation.playState === "running" &&
        animation.effect instanceof KeyframeEffect &&
        animation.effect.getComputedTiming().iterations !== Infinity &&
        animation.effect
          .getKeyframes()
          .some((keyframe) => "height" in keyframe || "gridTemplateRows" in keyframe),
    );
}
