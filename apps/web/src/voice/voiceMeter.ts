import { AutoLevel } from "@supaterm/client-runtime/voice-input";

export const VOICE_METER_WIDTH = 90;
export const VOICE_METER_HEIGHT = 26;

const COLUMNS = 33;
const ROWS = 9;
const PITCH = 2.6;
const MID = (ROWS - 1) / 2;
const HEAD = COLUMNS - 1;
const TAU = Math.PI * 2;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/**
 * A dot-matrix timeline of the voice. Each step writes the latest level as a column at the right
 * edge, next to the stop button, and scrolls the history left, dimming it with age.
 */
export class WriteHead {
  readonly columns = COLUMNS;
  readonly rows = ROWS;
  /** Each dot's brightness, 0–1, row by row. */
  readonly dots = new Float32Array(COLUMNS * ROWS);
  private readonly levels = new Float32Array(COLUMNS);
  private readonly auto = new AutoLevel();

  constructor() {
    this.render();
  }

  /** Writes a column for `loudness` dBFS and returns whether any dot changed. */
  write(loudness: number): boolean {
    this.levels.copyWithin(0, 1);
    this.levels[HEAD] = this.auto.step(loudness);
    return this.render();
  }

  private render(): boolean {
    let changed = false;
    for (let i = 0; i < COLUMNS; i++) {
      const extent = this.levels[i]! * (MID + 0.5);
      const fade = (0.28 + 0.72 * (i / HEAD) ** 1.8) * smoothstep(-1, 5, i);
      for (let j = 0; j < ROWS; j++) {
        const lit = clamp01(extent - Math.abs(j - MID) + 0.3);
        // The head column always shows a faint block, like a terminal cursor.
        const value = i === HEAD ? Math.max(0.16, lit) : lit * fade;
        const n = j * COLUMNS + i;
        const quantized = Math.round(value * 64) / 64;
        if (quantized !== this.dots[n]) {
          this.dots[n] = quantized;
          changed = true;
        }
      }
    }
    return changed;
  }
}

/** Draws the meter centred in a `VOICE_METER_WIDTH` by `VOICE_METER_HEIGHT` context, in `color`. */
export function paintVoiceMeter(
  context: CanvasRenderingContext2D,
  meter: WriteHead,
  color: string,
  dark: boolean,
): void {
  const unlit = dark ? 0.09 : 0.1;
  context.clearRect(0, 0, VOICE_METER_WIDTH, VOICE_METER_HEIGHT);
  context.fillStyle = color;
  const fill = (x: number, y: number, radius: number, alpha: number) => {
    context.globalAlpha = alpha;
    context.beginPath();
    context.arc(x, y, radius, 0, TAU);
    context.fill();
  };
  for (let j = 0; j < ROWS; j++) {
    const y = VOICE_METER_HEIGHT / 2 + (j - MID) * PITCH;
    for (let i = 0; i < COLUMNS; i++) {
      const x = VOICE_METER_WIDTH / 2 + (i - HEAD / 2) * PITCH;
      const value = meter.dots[j * COLUMNS + i]!;
      const radius = PITCH * (0.22 + 0.16 * value + (i === HEAD && value > 0.3 ? 0.08 : 0));
      if (value > 0.35) fill(x, y, radius * 1.9, 0.12 * value * value);
      fill(x, y, radius, unlit + (1 - unlit) * value ** 0.8);
    }
  }
  context.globalAlpha = 1;
}
