import { useEffect, useId, useRef, type HTMLAttributes, type MouseEvent } from "react";

import { useMediaQuery } from "../../hooks/useMediaQuery";
import { cn } from "../../lib/utils";
import type { BoltComputerState } from "./faces";
import { BoltComputerRenderer, frameFor } from "./render";
import { BoltComputerSim, POINTER_REACH } from "./sim";
import { onPointerMove, pointer, subscribe } from "./ticker";

export type { BoltComputerState } from "./faces";

function hashSeed(id: string) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

export interface BoltComputerProps extends HTMLAttributes<HTMLSpanElement> {
  readonly state?: BoltComputerState;
  /** The square the computer rests in, in px. Hops and its shadow draw past it. */
  readonly size?: number;
  /** Turn toward a nearby pointer, and hop with a spin on a click. */
  readonly interactive?: boolean;
}

/**
 * The app icon's retro computer, drawn in 3D on a 2D canvas with the bolt on its
 * LED screen. Adapted from robot-heads by Fayaz Ahmed (MIT).
 *
 * Idle settles and stops drawing until the pointer, a click or a state change
 * moves it again. Other states animate for as long as they are shown.
 */
export function BoltComputer({
  state = "idle",
  size = 160,
  interactive = true,
  className,
  style,
  onClick,
  ...rest
}: BoltComputerProps) {
  const boxRef = useRef<HTMLSpanElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<BoltComputerSim | null>(null);
  const rendererRef = useRef<BoltComputerRenderer | null>(null);
  const wakeRef = useRef<(() => void) | null>(null);
  const seed = hashSeed(useId());
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const frame = frameFor(size);

  useEffect(() => {
    const canvas = canvasRef.current;
    const box = boxRef.current;
    // Browsers refuse new contexts past their canvas memory limit; skip the decoration then.
    if (!canvas || !box || !canvas.getContext("2d")) return;
    simRef.current ??= new BoltComputerSim(seed, state);
    rendererRef.current ??= new BoltComputerRenderer();
    const sim = simRef.current;
    const renderer = rendererRef.current;
    const frame = frameFor(size);
    sim.setState(state);
    if (reducedMotion) {
      renderer.paint(canvas, frame, null, state);
      return;
    }

    const relativePointer = () => {
      if (!interactive || !Number.isFinite(pointer.x)) return null;
      const rect = box.getBoundingClientRect();
      const x = pointer.x - (rect.left + rect.width / 2);
      const y = pointer.y - (rect.top + rect.height / 2);
      return Math.hypot(x, y) < POINTER_REACH ? { x, y } : null;
    };
    let unsubscribe: (() => void) | null = null;
    const tick = (dt: number) => {
      sim.pointer = relativePointer();
      sim.update(dt);
      renderer.paint(canvas, frame, sim, state);
      if (sim.settled) {
        unsubscribe?.();
        unsubscribe = null;
      }
    };
    const wake = () => {
      unsubscribe ??= subscribe(tick);
    };
    wakeRef.current = wake;
    wake();
    const unlisten = onPointerMove(() => {
      if (sim.pointer !== null || relativePointer() !== null) wake();
    });
    return () => {
      unsubscribe?.();
      unlisten();
      wakeRef.current = null;
    };
  }, [state, size, interactive, reducedMotion]);

  const click = (event: MouseEvent<HTMLSpanElement>) => {
    if (interactive && !reducedMotion) {
      simRef.current?.poke();
      wakeRef.current?.();
    }
    onClick?.(event);
  };

  return (
    <span
      ref={boxRef}
      role="img"
      aria-label={state === "idle" ? "Supaterm" : `Supaterm, ${state}`}
      className={cn("relative block flex-none", interactive && "cursor-pointer", className)}
      style={{ width: size, height: size, ...style }}
      onClick={click}
      {...rest}
    >
      <canvas
        ref={canvasRef}
        aria-hidden
        className="pointer-events-none absolute block"
        style={{
          left: -frame.padSide,
          top: -frame.padTop,
          width: frame.box + 2 * frame.padSide,
          height: frame.box + frame.padTop + frame.padBottom,
        }}
      />
    </span>
  );
}
