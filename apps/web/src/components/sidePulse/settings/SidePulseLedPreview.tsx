import type { SidePulseDevice, SidePulseLedState } from "@supaterm/contracts";
import { sidePulseProgram } from "@supaterm/shared/sidePulsePrograms";
import { useEffect, useRef } from "react";

import { createSidePulseEngine, type SidePulseEngine } from "../sidePulseEngine";

const LED_PITCH = 14;
const LED_RADIUS = 4.5;
const GLOW_ROOM = 4;
const HEIGHT = 18;
// Repaint cost scales with frame rate; 20 fps still shows every step of the 95 ms roll.
const FRAME_MS = 1000 / 20;
// A moment when each animation is lit, so the first frame and the reduced-motion still show it.
const LIT_MS: Readonly<Record<SidePulseLedState, number>> = {
  attention: 800,
  working: 900,
  done: 1000,
  idle: 3900,
};

const panelWidth = (ledCount: number) => ledCount * LED_PITCH + GLOW_ROOM * 2;

function hexToRgb(hex: string): ReadonlyArray<number> {
  return [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
}

function drawLeds(canvas: HTMLCanvasElement, rgb: ArrayLike<number>, ledCount: number) {
  const context = canvas.getContext("2d");
  if (context === null) return;
  const scale = window.devicePixelRatio || 1;
  const width = panelWidth(ledCount);
  if (canvas.width !== Math.round(width * scale)) {
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(HEIGHT * scale);
  }
  context.setTransform(scale, 0, 0, scale, 0, 0);
  context.clearRect(0, 0, width, HEIGHT);
  for (let index = 0; index < ledCount; index += 1) {
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
  ledCount,
  brightness,
  fallbackColor,
}: {
  readonly ledState: SidePulseLedState;
  readonly ledCount: SidePulseDevice["ledCount"];
  readonly brightness: number;
  readonly fallbackColor: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- drives the canvas from SidePulse's firmware engine, only while the preview is on screen
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const startedAt = performance.now() - LIT_MS[ledState];
    let engine: SidePulseEngine | null = null;
    let disposed = false;
    let visible = false;
    let frameId = 0;
    let lastFrameAt = Number.NEGATIVE_INFINITY;
    let painted: Uint8Array | null = null;

    const paint = (now: number) => {
      if (engine === null) return;
      const frame = engine.step(now - startedAt);
      if (painted !== null && frame.every((value, index) => value === painted?.[index])) return;
      painted = frame.slice();
      drawLeds(canvas, frame, ledCount);
    };
    const loop = (now: number) => {
      frameId = requestAnimationFrame(loop);
      if (now - lastFrameAt < FRAME_MS) return;
      lastFrameAt = now;
      paint(now);
    };
    const sync = () => {
      cancelAnimationFrame(frameId);
      if (engine !== null && visible && !still && document.visibilityState === "visible") {
        frameId = requestAnimationFrame(loop);
      }
    };
    const observer = new IntersectionObserver((entries) => {
      visible = entries.some((entry) => entry.isIntersecting);
      sync();
    });

    drawLeds(canvas, new Uint8Array(ledCount * 3), ledCount);
    observer.observe(canvas);
    document.addEventListener("visibilitychange", sync);
    void createSidePulseEngine(ledCount).then(
      (created) => {
        if (disposed || !created.play(sidePulseProgram(ledState, ledCount, brightness))) return;
        engine = created;
        paint(performance.now());
        sync();
      },
      () => {
        if (disposed) return;
        drawLeds(
          canvas,
          Array.from({ length: ledCount }, () => hexToRgb(fallbackColor)).flat(),
          ledCount,
        );
      },
    );
    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      observer.disconnect();
      document.removeEventListener("visibilitychange", sync);
    };
  }, [ledState, ledCount, brightness, fallbackColor]);

  return (
    <span className="inline-flex rounded-full bg-led-panel px-1 py-0.5 ring-1 ring-border">
      <canvas ref={canvasRef} aria-hidden style={{ width: panelWidth(ledCount), height: HEIGHT }} />
    </span>
  );
}
