/*! @license robot-heads | Copyright (c) 2026 Fayaz Ahmed | MIT License | github.com/fayazara/robot-heads */
import type { BoltComputerState } from "./faces";
import { BoltComputerRenderer, frameFor, shellMaterial, type Look, type RGB } from "./render";
import { BoltComputerSim, POINTER_REACH } from "./sim";
import { onPointerMove, pointer, subscribe } from "./ticker";

export interface BoltComputerSettings {
  readonly state: BoltComputerState;
  /** `#rrggbb` */
  readonly shell: string;
  /** `#rrggbb` */
  readonly phosphor: string;
  /** `#rrggbb`, the round knob and the slider's handle. */
  readonly knobs: string;
  /** Multiplier on every animation. */
  readonly speed: number;
  /** Hold the state's still pose. */
  readonly paused: boolean;
  /** Turn toward a nearby pointer, and hop with a spin on a click. */
  readonly interactive: boolean;
  readonly floorShadow: boolean;
}

export const DEFAULT_SETTINGS: BoltComputerSettings = {
  state: "idle",
  shell: "#e2dbca",
  phosphor: "#fff06a",
  knobs: "#686c3a",
  speed: 1,
  paused: false,
  interactive: true,
  floorShadow: true,
};

export interface BoltComputer {
  readonly canvas: HTMLCanvasElement;
  update(changes: Partial<BoltComputerSettings>): void;
}

export const hexToRgb = (hex: string): RGB => {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

export const lookOf = (settings: BoltComputerSettings): Look => ({
  state: settings.state,
  shell: shellMaterial(hexToRgb(settings.shell)),
  phosphor: hexToRgb(settings.phosphor),
  knobs: hexToRgb(settings.knobs),
  floorShadow: settings.floorShadow,
});

/**
 * Adds a canvas with the app icon's computer to `container`, filling it. It switches on, turns
 * toward a nearby pointer and hops with a spin on a click. Frames are drawn only while it moves
 * on screen. The canvas reaches past the container so hops and the floor's shadow take no layout
 * space.
 * The error state shakes on forever unless `restAfter` seconds lets it rest between shakes.
 * Returns null, adding nothing, if the browser refuses a 2D context.
 */
export function mountBoltComputer(
  container: HTMLElement,
  initial: BoltComputerSettings = DEFAULT_SETTINGS,
  restAfter = Number.POSITIVE_INFINITY,
): BoltComputer | null {
  const canvas = document.createElement("canvas");
  if (!canvas.getContext("2d")) return null;
  canvas.setAttribute("aria-hidden", "true");
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let settings = initial;
  let look = lookOf(settings);
  // Off screen it holds the still pose, so the canvas stays current for anything that reads it.
  let onScreen = true;
  const still = () => reducedMotion || settings.paused || !onScreen;
  const sim = new BoltComputerSim(Math.random(), settings.state, restAfter);
  const renderer = new BoltComputerRenderer();
  let frame = frameFor(container.clientWidth);

  const relativePointer = () => {
    if (!settings.interactive || !Number.isFinite(pointer.x)) return null;
    const rect = container.getBoundingClientRect();
    const x = pointer.x - (rect.left + rect.width / 2);
    const y = pointer.y - (rect.top + rect.height / 2);
    return Math.hypot(x, y) < POINTER_REACH ? { x, y } : null;
  };

  let unsubscribe: (() => void) | null = null;
  const stop = () => {
    unsubscribe?.();
    unsubscribe = null;
  };
  const tick = (dt: number) => {
    sim.pointer = relativePointer();
    sim.update(dt * settings.speed);
    renderer.paint(canvas, frame, sim, look);
    if (sim.settled) stop();
  };
  const draw = () => {
    if (still()) {
      stop();
      renderer.paint(canvas, frame, null, look);
    } else if (unsubscribe === null) {
      unsubscribe = subscribe(tick);
    }
  };
  const place = () => {
    frame = frameFor(container.clientWidth);
    Object.assign(canvas.style, {
      left: `${-frame.padSide}px`,
      top: `${-frame.padTop}px`,
      width: `${frame.box + 2 * frame.padSide}px`,
      height: `${frame.box + frame.padTop + frame.padBottom}px`,
    });
    draw();
  };

  place();
  container.append(canvas);
  new ResizeObserver(place).observe(container);
  new IntersectionObserver(([entry]) => {
    onScreen = entry?.isIntersecting ?? onScreen;
    draw();
  }).observe(canvas);
  onPointerMove(() => {
    if (!still() && (sim.pointer !== null || relativePointer() !== null)) draw();
  });
  container.addEventListener("click", () => {
    if (still() || !settings.interactive) return;
    sim.poke();
    draw();
  });

  return {
    canvas,
    update(changes) {
      settings = { ...settings, ...changes };
      look = lookOf(settings);
      sim.setState(settings.state);
      if (still()) sim.skipFade();
      draw();
    },
  };
}
