/*! @license robot-heads | Copyright (c) 2026 Fayaz Ahmed | MIT License | github.com/fayazara/robot-heads */
import type { BoltComputerState } from "./faces";
import { BoltComputerRenderer, frameFor, shellMaterial, type Look, type RGB } from "./render";
import { BoltComputerSim, POINTER_REACH } from "./sim";
import { onPointerMove, pointer, subscribe } from "./ticker";

export interface BoltComputerSettings {
  readonly state: BoltComputerState;

  readonly shell: string;

  readonly phosphor: string;

  readonly knobs: string;

  readonly controls: boolean;

  readonly speed: number;

  readonly paused: boolean;

  readonly interactive: boolean;
  readonly floorShadow: boolean;
}

export const DEFAULT_SETTINGS: BoltComputerSettings = {
  state: "idle",
  shell: "#e2dbca",
  phosphor: "#fff06a",
  knobs: "#686c3a",
  controls: true,
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
  controls: settings.controls,
  floorShadow: settings.floorShadow,
});

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
