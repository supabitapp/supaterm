import { type LayoutShiftAnchor, revealSurface, slideNeighbours } from "~/lib/layoutShift";

const OWN_SURFACES_ATTRIBUTE = "data-model-strip-transition";
const ownSurfaceHolds = new WeakMap<Element, number>();

const hold = <T>(value: T) => [value, value];

/**
 * Makes the shell's parts paint their own surfaces instead of the shell's shared glass,
 * until the returned release runs. Reveals overlap, so the shell counts its holders.
 */
export function paintOwnSurfaces(shell: Element) {
  ownSurfaceHolds.set(shell, (ownSurfaceHolds.get(shell) ?? 0) + 1);
  shell.setAttribute(OWN_SURFACES_ATTRIBUTE, "true");
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const holds = (ownSurfaceHolds.get(shell) ?? 1) - 1;
    ownSurfaceHolds.set(shell, holds);
    if (holds === 0) shell.removeAttribute(OWN_SURFACES_ATTRIBUTE);
  };
}

/**
 * Hides the host's outline and moves its shadow onto the main surface. A height reveal
 * keeps the host's box at its largest size, where both would show the wrong shape.
 */
export function carryHostSurface(host: Element, main: Element, timing: KeyframeAnimationOptions) {
  const animations = [
    host.animate({ visibility: hold("hidden") }, { ...timing, pseudoElement: "::after" }),
  ];
  const shadow = getComputedStyle(host).boxShadow;
  if (shadow !== "none") {
    animations.push(
      host.animate({ boxShadow: hold("none") }, timing),
      main.animate({ boxShadow: hold(shadow) }, timing),
    );
  }
  return animations;
}

/**
 * Shows the composer's main surface with its top edge `hidden` pixels lower than layout
 * puts it, and slides what sits above the composer along. The first animation is the
 * surface's own; the caller holds the layout height and sets the shell's own-surface mode.
 */
export function revealComposerSurface(
  main: HTMLElement,
  hidden: readonly [number, number],
  timing: KeyframeAnimationOptions,
) {
  const anchor: LayoutShiftAnchor = "bottom";
  const animations = [
    ...revealSurface(main, anchor, hidden, timing),
    ...slideNeighbours(main, anchor, hidden, timing),
  ];
  const host = main.closest('[data-slot="composer-host"]');
  if (host) animations.push(...carryHostSurface(host, main, timing));
  return animations;
}
