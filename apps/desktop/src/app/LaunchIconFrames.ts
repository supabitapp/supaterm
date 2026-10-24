import { BOLT_CELLS, thinkingLevel } from "@supaterm/shared/boltFace";

// 05-Glass-Lightning.svg lays the LEDs out on this grid in its 80-unit viewBox,
// then scales the group about the middle of the screen.
const VIEWBOX = 80;
const LED_GRID = { x: 30, y: 18, pitchX: 1.38, pitchY: 1.28, width: 1.15, height: 1.06 };
const BOLT_GROUP = { x: 40, y: 34.8, scale: 1.22, originX: 39, originY: 32.6 };
// The macOS icon grid draws the canvas as an 824px body centred in a 1024px tile.
const MAC_ICON_BODY = 824 / 1024;

const toTile = (svg: number) => (svg / VIEWBOX) * MAC_ICON_BODY + (1 - MAC_ICON_BODY) / 2;
const PITCH_X = toTile(BOLT_GROUP.scale * LED_GRID.pitchX) - toTile(0);
const PITCH_Y = toTile(BOLT_GROUP.scale * LED_GRID.pitchY) - toTile(0);

/** Where the bolt's LED at `column`, `row` sits, as a fraction of the macOS icon tile. */
export const ledCenter = (column: number, row: number): readonly [number, number] => [
  toTile(
    BOLT_GROUP.x +
      BOLT_GROUP.scale *
        (LED_GRID.x + column * LED_GRID.pitchX + LED_GRID.width / 2 - BOLT_GROUP.originX),
  ),
  toTile(
    BOLT_GROUP.y +
      BOLT_GROUP.scale *
        (LED_GRID.y + row * LED_GRID.pitchY + LED_GRID.height / 2 - BOLT_GROUP.originY),
  ),
];

// Pixels this far apart in the two renders are resampling noise, not LED light.
const LIGHT_THRESHOLD = 8;
// In LED pitches: sharp enough that a sparking LED owns its cell, wide enough
// that the glow between two LEDs blends them.
const SPREAD = 0.35;
const falloff = (distanceSquared: number) => Math.exp(-distanceSquared / (2 * SPREAD * SPREAD));
// Glow a full pitch from every LED, out in the screen's bloom, follows the bolt as a whole.
const MEAN_WEIGHT = falloff(1);

export interface LaunchIconFrames {
  /**
   * The tile `t` seconds into thinking, `glow` of the way back to the lit icon.
   * The buffer is reused by the next call.
   */
  readonly render: (t: number, glow: number) => Buffer;
}

/**
 * Frames between two renders of the same icon, one with the bolt lit and one
 * with it switched off, each a `size` square of 4-byte pixels.
 */
export function makeLaunchIconFrames(lit: Buffer, unlit: Buffer, size: number): LaunchIconFrames {
  const cellIndex = new Map(BOLT_CELLS.map(([c, r], index) => [`${c},${r}`, index]));
  const [originX, originY] = ledCenter(0, 0);
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
      const column = ((x + 0.5) / size - originX) / PITCH_X;
      const row = ((y + 0.5) / size - originY) / PITCH_Y;
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
  const levels = new Float32Array(BOLT_CELLS.length);
  return {
    render: (t, glow) => {
      let sum = 0;
      BOLT_CELLS.forEach(([c, r], index) => {
        const level = 1 - (1 - thinkingLevel(c, r, t)) * (1 - glow);
        levels[index] = level;
        sum += level;
      });
      const mean = sum / BOLT_CELLS.length;
      for (let k = 0; k < pixels.length; k++) {
        let level = (meanWeights[k] ?? 0) * mean;
        for (let j = offsets[k] ?? 0; j < (offsets[k + 1] ?? 0); j++) {
          level += (weights[j] ?? 0) * (levels[leds[j] ?? 0] ?? 0);
        }
        const o = pixels[k] ?? 0;
        for (let ch = 0; ch < 4; ch++) {
          const off = unlit[o + ch] ?? 0;
          output[o + ch] = off + ((lit[o + ch] ?? 0) - off) * level;
        }
      }
      return frame;
    },
  };
}
