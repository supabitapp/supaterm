import { BOLT_CELLS, thinkingLevel } from "@supaterm/shared/boltFace";

import { LAUNCH_ICON_LEDS } from "./LaunchIconLeds.generated.ts";

/** Where the bolt's LED at `column`, `row` lights, as a fraction of the macOS icon tile. */
export const ledCenter = (column: number, row: number): readonly [number, number] => [
  LAUNCH_ICON_LEDS.x + column * LAUNCH_ICON_LEDS.pitchX,
  LAUNCH_ICON_LEDS.y + row * LAUNCH_ICON_LEDS.pitchY,
];

// Pixels this far apart in the two renders are resampling noise, not LED light.
const LIGHT_THRESHOLD = 8;
// In LED pitches: sharp enough that a sparking LED owns its cell, wide enough
// that the glow between two LEDs blends them.
const SPREAD = 0.35;
const falloff = (distanceSquared: number) => Math.exp(-distanceSquared / (2 * SPREAD * SPREAD));
// Glow a full pitch from every LED, out in the screen's bloom, follows the bolt as a whole.
const MEAN_WEIGHT = falloff(1);

// While thinking, a rainbow runs down the bolt: one turn of hue per period,
// spread over this many cells along the diagonal.
const HUE_PERIOD_SECONDS = 2.4;
const HUE_WAVELENGTH_CELLS = 24;
const hueAt = (column: number, row: number, t: number) =>
  2 * Math.PI * (t / HUE_PERIOD_SECONDS - (column + row) / HUE_WAVELENGTH_CELLS);

// CSS's hue-rotate(θ) is LUMA + cos θ · COS + sin θ · SIN, row-major over RGB.
// It keeps luminance, and grey light stays grey.
const LUMA = [0.213, 0.715, 0.072, 0.213, 0.715, 0.072, 0.213, 0.715, 0.072];
const COS = [0.787, -0.715, -0.072, -0.213, 0.285, -0.072, -0.213, -0.715, 0.928];
const SIN = [-0.213, -0.715, 0.928, 0.143, 0.14, -0.283, -0.787, 0.715, 0.072];

export interface LaunchIconFrames {
  /**
   * The tile `t` seconds into thinking, `glow` of the way back to the lit icon
   * in its own colour. The buffer is reused by the next call.
   */
  readonly render: (t: number, glow: number) => Buffer;
}

/**
 * Frames between two renders of the same icon, one with the bolt lit and one
 * with it switched off, each a `size` square of BGRA pixels as macOS bitmaps are.
 */
export function makeLaunchIconFrames(lit: Buffer, unlit: Buffer, size: number): LaunchIconFrames {
  const cellIndex = new Map(BOLT_CELLS.map(([c, r], index) => [`${c},${r}`, index]));
  const pixels: number[] = [];
  const offsets: number[] = [0];
  const leds: number[] = [];
  const weights: number[] = [];
  const meanWeights: number[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4;
      let difference = 0;
      for (let ch = 0; ch < 4; ch++) {
        difference += Math.abs((lit[o + ch] ?? 0) - (unlit[o + ch] ?? 0));
      }
      if (difference <= LIGHT_THRESHOLD) continue;
      const column = ((x + 0.5) / size - LAUNCH_ICON_LEDS.x) / LAUNCH_ICON_LEDS.pitchX;
      const row = ((y + 0.5) / size - LAUNCH_ICON_LEDS.y) / LAUNCH_ICON_LEDS.pitchY;
      const start = leds.length;
      let total = MEAN_WEIGHT;
      for (let r = Math.round(row) - 1; r <= Math.round(row) + 1; r++) {
        for (let c = Math.round(column) - 1; c <= Math.round(column) + 1; c++) {
          const index = cellIndex.get(`${c},${r}`);
          if (index === undefined) continue;
          const weight = falloff((column - c) ** 2 + (row - r) ** 2);
          leds.push(index);
          weights.push(weight);
          total += weight;
        }
      }
      for (let j = start; j < weights.length; j++) weights[j] = (weights[j] ?? 0) / total;
      pixels.push(o);
      offsets.push(leds.length);
      meanWeights.push(MEAN_WEIGHT / total);
    }
  }

  const output = new Uint8ClampedArray(lit);
  const frame = Buffer.from(output.buffer, output.byteOffset, output.byteLength);
  // Each LED's brightness, and that brightness carried on cos θ and sin θ of its
  // hue turn, so a pixel blends its LEDs' rotations by blending three sums.
  const levels = new Float64Array(BOLT_CELLS.length);
  const cosines = new Float64Array(BOLT_CELLS.length);
  const sines = new Float64Array(BOLT_CELLS.length);
  const rotation = new Float64Array(9);
  const rotated = (row: number, red: number, green: number, blue: number) =>
    (rotation[row * 3] ?? 0) * red +
    (rotation[row * 3 + 1] ?? 0) * green +
    (rotation[row * 3 + 2] ?? 0) * blue;
  return {
    render: (t, glow) => {
      let meanLevel = 0;
      let meanCosine = 0;
      let meanSine = 0;
      BOLT_CELLS.forEach(([c, r], index) => {
        const level = 1 - (1 - thinkingLevel(c, r, t)) * (1 - glow);
        const hue = hueAt(c, r, t);
        levels[index] = level;
        cosines[index] = level * (glow + (1 - glow) * Math.cos(hue));
        sines[index] = level * (1 - glow) * Math.sin(hue);
        meanLevel += level / BOLT_CELLS.length;
        meanCosine += (cosines[index] ?? 0) / BOLT_CELLS.length;
        meanSine += (sines[index] ?? 0) / BOLT_CELLS.length;
      });
      for (let k = 0; k < pixels.length; k++) {
        const meanWeight = meanWeights[k] ?? 0;
        let level = meanWeight * meanLevel;
        let cosine = meanWeight * meanCosine;
        let sine = meanWeight * meanSine;
        for (let j = offsets[k] ?? 0; j < (offsets[k + 1] ?? 0); j++) {
          const weight = weights[j] ?? 0;
          const led = leds[j] ?? 0;
          level += weight * (levels[led] ?? 0);
          cosine += weight * (cosines[led] ?? 0);
          sine += weight * (sines[led] ?? 0);
        }
        for (let i = 0; i < 9; i++) {
          rotation[i] = (LUMA[i] ?? 0) * level + (COS[i] ?? 0) * cosine + (SIN[i] ?? 0) * sine;
        }
        const o = pixels[k] ?? 0;
        const red = (lit[o + 2] ?? 0) - (unlit[o + 2] ?? 0);
        const green = (lit[o + 1] ?? 0) - (unlit[o + 1] ?? 0);
        const blue = (lit[o] ?? 0) - (unlit[o] ?? 0);
        output[o + 2] = (unlit[o + 2] ?? 0) + rotated(0, red, green, blue);
        output[o + 1] = (unlit[o + 1] ?? 0) + rotated(1, red, green, blue);
        output[o] = (unlit[o] ?? 0) + rotated(2, red, green, blue);
        output[o + 3] = (unlit[o + 3] ?? 0) + ((lit[o + 3] ?? 0) - (unlit[o + 3] ?? 0)) * level;
      }
      return frame;
    },
  };
}
