import type { SidePulseEffect, SidePulseLedState, SidePulseSettings } from "@supaterm/contracts";
import { SIDE_PULSE_LED_COUNT, sidePulseProgram } from "@supaterm/shared/sidePulsePrograms";
import { useEffect, useRef } from "react";

import { observeIntersection } from "../../../lib/observeIntersection";
import { createSidePulseEngine, type SidePulseEngine } from "../sidePulseEngine";

const LED_PITCH = 14;
const LED_RADIUS = 4.5;
const GLOW_ROOM = 4;
const HEIGHT = 18;
// Cost scales with frame rate; 20 fps still shows every step of the 95 ms roll.
const FRAME_MS = 1000 / 20;
// A moment when each animation is lit, so the first frame and the reduced-motion still show it.
const LIT_MS: Readonly<Record<SidePulseEffect, number>> = {
  solid: 1000,
  breathe: 2000,
  pulse: 800,
  heartbeat: 130,
  glow: 3900,
  roll: 900,
  ripple: 910,
  scanner: 430,
  twinkle: 1170,
  rainbow: 1000,
  spectrum: 2250,
};

const PANEL_WIDTH = SIDE_PULSE_LED_COUNT * LED_PITCH + GLOW_ROOM * 2;

// One ticker paints every preview in the same animation frame, so the page composites once per tick.
const frameListeners = new Set<(now: number) => void>();
let frameTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleFrame() {
  frameTimer = setTimeout(() => {
    requestAnimationFrame((now) => {
      frameTimer = undefined;
      for (const listener of frameListeners) {
        try {
          listener(now);
        } catch (error) {
          // One preview's failure must not stop the others; report it without breaking the loop.
          queueMicrotask(() => {
            throw error;
          });
        }
      }
      if (frameListeners.size > 0) scheduleFrame();
    });
  }, FRAME_MS);
}

function onFrame(listener: (now: number) => void): () => void {
  frameListeners.add(listener);
  if (frameTimer === undefined) scheduleFrame();
  return () => {
    frameListeners.delete(listener);
  };
}

function hexToRgb(hex: string): ReadonlyArray<number> {
  return [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
}

function drawLeds(canvas: HTMLCanvasElement, rgb: ArrayLike<number>) {
  const context = canvas.getContext("2d");
  if (context === null) return;
  const scale = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(PANEL_WIDTH * scale)) {
    canvas.width = Math.round(PANEL_WIDTH * scale);
    canvas.height = Math.round(HEIGHT * scale);
  }
  context.setTransform(scale, 0, 0, scale, 0, 0);
  context.clearRect(0, 0, PANEL_WIDTH, HEIGHT);
  for (let index = 0; index < SIDE_PULSE_LED_COUNT; index += 1) {
    const red = rgb[index * 3] ?? 0;
    const green = rgb[index * 3 + 1] ?? 0;
    const blue = rgb[index * 3 + 2] ?? 0;
    const level = Math.max(red, green, blue) / 255;
    const color = `rgb(${red}, ${green}, ${blue})`;
    context.beginPath();
    context.arc(
      GLOW_ROOM + index * LED_PITCH + LED_PITCH / 2,
      HEIGHT / 2,
      LED_RADIUS,
      0,
      Math.PI * 2,
    );
    context.shadowColor = color;
    context.shadowBlur = 8 * level;
    context.fillStyle = color;
    context.fill();
    context.shadowBlur = 0;
    if (level < 0.05) {
      context.strokeStyle = "rgba(255, 255, 255, 0.14)";
      context.lineWidth = 1;
      context.stroke();
    }
  }
}

/** A SidePulse running `ledState` through its own firmware engine, as the device would show it. */
export function SidePulseLedPreview({
  ledState,
  settings,
  fallbackColor,
}: {
  readonly ledState: SidePulseLedState;
  readonly settings: SidePulseSettings;
  readonly fallbackColor: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const program = sidePulseProgram(ledState, settings);
  const litMs = LIT_MS[settings.effects[ledState]];
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- drives the canvas from SidePulse's firmware engine, only while the preview is on screen
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let engine: SidePulseEngine | null = null;
    let startedAt = 0;
    let disposed = false;
    let visible = false;
    let stopFrames: (() => void) | null = null;
    let painted: Uint8Array | null = null;

    const paintAt = (engineMs: number) => {
      if (engine === null) return;
      const frame = engine.step(engineMs);
      if (painted !== null && frame.every((value, index) => value === painted?.[index])) return;
      painted = frame.slice();
      drawLeds(canvas, frame);
    };
    // Restarts at the lit moment: the first frame, the reduced-motion still, and where motion resumes.
    const showLitFrame = () => {
      if (engine === null) return;
      engine.play(program);
      startedAt = performance.now() - litMs;
      paintAt(litMs);
    };
    const sync = () => {
      const animate =
        engine !== null &&
        visible &&
        !reducedMotion.matches &&
        document.visibilityState === "visible";
      if (animate && stopFrames === null) {
        stopFrames = onFrame((now) => paintAt(now - startedAt));
      } else if (!animate && stopFrames !== null) {
        stopFrames();
        stopFrames = null;
      }
    };
    const onMotionPreferenceChange = () => {
      showLitFrame();
      sync();
    };

    drawLeds(canvas, new Uint8Array(SIDE_PULSE_LED_COUNT * 3));
    const stopObserving = observeIntersection(canvas, (entry) => {
      visible = entry.isIntersecting;
      sync();
    });
    document.addEventListener("visibilitychange", sync);
    reducedMotion.addEventListener("change", onMotionPreferenceChange);
    void createSidePulseEngine().then(
      (created) => {
        if (disposed || !created.play(program)) return;
        engine = created;
        showLitFrame();
        sync();
      },
      () => {
        if (disposed) return;
        drawLeds(
          canvas,
          Array.from({ length: SIDE_PULSE_LED_COUNT }, () => hexToRgb(fallbackColor)).flat(),
        );
      },
    );
    return () => {
      disposed = true;
      stopFrames?.();
      stopObserving();
      document.removeEventListener("visibilitychange", sync);
      reducedMotion.removeEventListener("change", onMotionPreferenceChange);
    };
  }, [program, litMs, fallbackColor]);

  return (
    <span className="inline-flex rounded-full bg-led-panel px-1 py-0.5 ring-1 ring-border">
      <canvas ref={canvasRef} aria-hidden style={{ width: PANEL_WIDTH, height: HEIGHT }} />
    </span>
  );
}
