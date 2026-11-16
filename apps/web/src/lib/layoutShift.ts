import { EASE_DRAWER } from "./motion";

export const LAYOUT_SHIFT_EVENT = "supaterm:layoutshift";

/** The edge that stays put on screen while the height changes. */
export type LayoutShiftAnchor = "top" | "bottom";

/**
 * One height change shown with clips and transforms instead of an animated layout.
 * Dispatched from the element that changed so whoever positions things around it can
 * move them in step.
 */
export interface LayoutShift {
  readonly anchor: LayoutShiftAnchor;
  /**
   * Translation, at the start and at the end, of what the moving edge pushes. A nonzero
   * end means the origin holds a taller layout until the shift settles.
   */
  readonly offsets: readonly [number, number];
  readonly timing: KeyframeAnimationOptions;
  /** Starts and cancels the animation with the shift. */
  readonly add: (animation: Animation) => void;
  /** Delays the start until the returned function runs, for layout that lands a frame late. */
  readonly hold: () => () => void;
  /** Resolves once the origin has its final layout height. */
  readonly settled: Promise<void>;
}

export interface HeightReveal {
  /** Ends the reveal. Returns the heights it had reached, or null when it had already ended. */
  readonly stop: () => { readonly visible: number; readonly layout: number } | null;
}

const SURFACE_SELECTOR = "[data-height-reveal-surface]";
const EDGE_SELECTOR = ":scope > [data-height-reveal-edge]";
const CORNER_STEPS = 12;
// Room for shadows outside the surface, which the clip must not cut.
const CLIP_MARGIN = "200px";

function flowsWithParent(element: Element) {
  const position = getComputedStyle(element).position;
  return position === "static" || position === "relative" || position === "sticky";
}

/** In-flow elements laid out before (`previous`) or after `start`, out to the scroll container. */
function flowNeighbours(start: HTMLElement, direction: "previous" | "next") {
  const neighbours: HTMLElement[] = [];
  const step = (element: Element) =>
    direction === "next" ? element.nextElementSibling : element.previousElementSibling;
  for (let node: HTMLElement | null = start; node; node = node.parentElement) {
    if (!flowsWithParent(node) || /auto|scroll/.test(getComputedStyle(node).overflowY)) break;
    for (let sibling = step(node); sibling; sibling = step(sibling)) {
      if (sibling instanceof HTMLElement && flowsWithParent(sibling)) neighbours.push(sibling);
    }
  }
  return neighbours;
}

/** A clip that hides the top `hidden` pixels and keeps the top corners round. */
function roundedTopClip(hidden: number, radius: number) {
  const points = [`-${CLIP_MARGIN} ${hidden + radius}px`];
  for (let step = 0; step <= CORNER_STEPS; step += 1) {
    const angle = (step / CORNER_STEPS) * (Math.PI / 2);
    points.push(`${radius * (1 - Math.cos(angle))}px ${hidden + radius * (1 - Math.sin(angle))}px`);
  }
  for (let step = CORNER_STEPS; step >= 0; step -= 1) {
    const angle = (step / CORNER_STEPS) * (Math.PI / 2);
    points.push(
      `calc(100% - ${radius * (1 - Math.cos(angle))}px) ${hidden + radius * (1 - Math.sin(angle))}px`,
    );
  }
  points.push(
    `calc(100% + ${CLIP_MARGIN}) ${hidden + radius}px`,
    `calc(100% + ${CLIP_MARGIN}) calc(100% + ${CLIP_MARGIN})`,
    `-${CLIP_MARGIN} calc(100% + ${CLIP_MARGIN})`,
  );
  return `polygon(${points.join(", ")})`;
}

/**
 * Animations that make `surface` look `hidden` pixels shorter at its moving edge. A
 * bottom-anchored surface also slides its `data-height-reveal-edge` child, which draws
 * the border arc the clip cuts off.
 */
export function revealSurface(
  surface: HTMLElement,
  anchor: LayoutShiftAnchor,
  hidden: readonly [number, number],
  timing: KeyframeAnimationOptions,
) {
  const style = getComputedStyle(surface);
  if (anchor === "top") {
    const clip = (inset: number) => `inset(0px 0px ${inset}px 0px round ${style.borderRadius})`;
    return [surface.animate({ clipPath: hidden.map(clip) }, timing)];
  }
  const radius = Number.parseFloat(style.borderTopLeftRadius) || 0;
  const animations = [
    surface.animate({ clipPath: hidden.map((inset) => roundedTopClip(inset, radius)) }, timing),
  ];
  const edge = surface.querySelector<HTMLElement>(EDGE_SELECTOR);
  if (edge) {
    animations.push(
      edge.animate(
        { visibility: ["visible", "visible"], translate: hidden.map((inset) => `0 ${inset}px`) },
        timing,
      ),
    );
  }
  return animations;
}

/** Slides what a moving `anchor`-opposite edge of `origin` pushes: what follows it, or what precedes it. */
export function slideNeighbours(
  origin: HTMLElement,
  anchor: LayoutShiftAnchor,
  offsets: readonly [number, number],
  timing: KeyframeAnimationOptions,
) {
  // Added to any other slide on the same element: two stacked parts can both push it.
  return flowNeighbours(origin, anchor === "top" ? "next" : "previous").map((neighbour) =>
    neighbour.animate(
      { translate: offsets.map((offset) => `0 ${offset}px`) },
      { ...timing, composite: "add" },
    ),
  );
}

/**
 * Shows `target` going from `from` to `to` pixels tall without animating layout. Layout
 * keeps the taller height for the whole run while clips uncover or hide the rest and the
 * neighbours slide. A `data-height-reveal-surface` ancestor is the box that resizes.
 */
export function revealHeightChange(
  target: HTMLElement,
  from: number,
  to: number,
  laidOut: number,
  anchor: LayoutShiftAnchor = "top",
  duration = to > from ? 200 : 150,
): HeightReveal {
  const layout = Math.max(laidOut, to);
  const held = to < layout;
  if (held) target.style.height = `${layout}px`;
  const hidden = [layout - from, layout - to] as const;
  const offsets = anchor === "top" ? ([-hidden[0], -hidden[1]] as const) : hidden;
  const timing: KeyframeAnimationOptions = { duration, easing: EASE_DRAWER, fill: "forwards" };
  const animations: Animation[] = [];
  let holds = 0;
  let started = false;
  let done = false;
  const add = (animation: Animation) => {
    if (done) return animation.cancel();
    if (!started) animation.pause();
    animations.push(animation);
  };

  const clip = { clipPath: hidden.map((inset) => `inset(-2px -2px ${inset}px -2px)`) };
  // A bottom-anchored target slides down with its content and loses the overhang.
  const slide = anchor === "bottom" ? { translate: hidden.map((inset) => `0 ${inset}px`) } : {};
  add(target.animate({ ...clip, ...slide }, timing));
  const surface = target.closest<HTMLElement>(SURFACE_SELECTOR);
  if (surface)
    for (const animation of revealSurface(surface, anchor, hidden, timing)) add(animation);
  for (const animation of slideNeighbours(target, anchor, offsets, timing)) add(animation);

  let resolveSettled = () => {};
  const settled = new Promise<void>((resolve) => {
    resolveSettled = resolve;
  });
  const settle = () => {
    if (done) return;
    done = true;
    for (const animation of animations) animation.cancel();
    if (held) target.style.removeProperty("height");
    resolveSettled();
  };
  const start = () => {
    if (started || done || holds > 0) return;
    started = true;
    for (const animation of animations) animation.play();
    void Promise.allSettled(animations.map((animation) => animation.finished)).then(settle);
  };
  const shift: LayoutShift = {
    anchor,
    offsets,
    timing,
    add,
    hold: () => {
      holds += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        holds -= 1;
        start();
      };
    },
    settled,
  };
  target.dispatchEvent(new CustomEvent(LAYOUT_SHIFT_EVENT, { bubbles: true, detail: shift }));
  start();

  return {
    stop: () => {
      if (done) return null;
      const progress = animations[0]?.effect?.getComputedTiming().progress ?? 1;
      settle();
      return { visible: from + (to - from) * progress, layout };
    },
  };
}
