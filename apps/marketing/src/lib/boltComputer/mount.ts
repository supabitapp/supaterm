/*! @license robot-heads | Copyright (c) 2026 Fayaz Ahmed | MIT License | github.com/fayazara/robot-heads */
import { BoltComputerRenderer, frameFor } from "./render";
import { BoltComputerSim, POINTER_REACH } from "./sim";
import { onPointerMove, pointer, subscribe } from "./ticker";

/**
 * Adds a canvas with the app icon's computer to `container`, filling it. It switches on, turns
 * toward a nearby pointer and hops with a spin on a click. Frames are drawn only while it moves.
 * The canvas reaches past the container so hops and the floor's shadow take no layout space.
 * Nothing is added if the browser refuses a 2D context.
 */
export function mountBoltComputer(container: HTMLElement) {
  const canvas = document.createElement("canvas");
  if (!canvas.getContext("2d")) return;
  canvas.setAttribute("aria-hidden", "true");
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const sim = new BoltComputerSim(Math.random());
  const renderer = new BoltComputerRenderer();
  let frame = frameFor(container.clientWidth);

  const relativePointer = () => {
    if (!Number.isFinite(pointer.x)) return null;
    const rect = container.getBoundingClientRect();
    const x = pointer.x - (rect.left + rect.width / 2);
    const y = pointer.y - (rect.top + rect.height / 2);
    return Math.hypot(x, y) < POINTER_REACH ? { x, y } : null;
  };

  let unsubscribe: (() => void) | null = null;
  const tick = (dt: number) => {
    sim.pointer = relativePointer();
    sim.update(dt);
    renderer.paint(canvas, frame, sim);
    if (sim.settled) {
      unsubscribe?.();
      unsubscribe = null;
    }
  };
  const draw = () => {
    if (still) renderer.paint(canvas, frame, null);
    else if (unsubscribe === null) unsubscribe = subscribe(tick);
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
  if (still) return;
  onPointerMove(() => {
    if (sim.pointer !== null || relativePointer() !== null) draw();
  });
  container.addEventListener("click", () => {
    sim.poke();
    draw();
  });
}
