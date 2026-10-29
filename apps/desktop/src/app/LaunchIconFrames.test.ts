import { BOLT_CELLS, thinkingLevel } from "@supaterm/shared/boltFace";
import { assert, describe, it } from "@effect/vitest";

import { makeLaunchIconFrames } from "./LaunchIconFrames.ts";
import { LAUNCH_ICON_LEDS } from "./LaunchIconLeds.generated.ts";

const SIZE = 256;
const ledCenter = (column: number, row: number): readonly [number, number] => [
  LAUNCH_ICON_LEDS.x + column * LAUNCH_ICON_LEDS.pitchX,
  LAUNCH_ICON_LEDS.y + row * LAUNCH_ICON_LEDS.pitchY,
];
const OFF = [14, 14, 14, 255] as const;
// BGRA, as macOS bitmaps are.
const YELLOW = [110, 240, 250, 255] as const;
const GREY = [200, 200, 200, 255] as const;

function iconPair(on: readonly number[]) {
  const unlit = Buffer.alloc(SIZE * SIZE * 4);
  for (let i = 0; i < SIZE * SIZE; i++) unlit.set(OFF, i * 4);
  const lit = Buffer.from(unlit);
  for (const [c, r] of BOLT_CELLS) {
    const [u, v] = ledCenter(c, r);
    const x = Math.floor(u * SIZE);
    const y = Math.floor(v * SIZE);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) lit.set(on, ((y + dy) * SIZE + x + dx) * 4);
    }
  }
  return { lit, unlit };
}

const pixelAt = (frame: Buffer, [u, v]: readonly [number, number]) => {
  const o = (Math.floor(v * SIZE) * SIZE + Math.floor(u * SIZE)) * 4;
  return { blue: frame[o] ?? 0, red: frame[o + 2] ?? 0 };
};

describe("LaunchIconFrames", () => {
  it("lands on the exact icon once the glow is back, so the Dock's handoff does not jump", () => {
    const { lit, unlit } = iconPair(YELLOW);
    const icon = Buffer.from(lit);
    for (let i = 0; i < icon.length; i += 4) icon[i] = (icon[i] ?? 0) - 10;
    const frames = makeLaunchIconFrames(lit, unlit, SIZE, icon);

    frames.render(1.3, 0);

    assert.isTrue(frames.render(1.3, 1).equals(icon));
  });

  it("lights each LED at its own thinking level and leaves the rest of the icon alone", () => {
    const { lit, unlit } = iconPair(GREY);
    const frames = makeLaunchIconFrames(lit, unlit, SIZE, lit);
    const t = 2.4;
    const byLevel = [...BOLT_CELLS].sort(
      ([ac, ar], [bc, br]) => thinkingLevel(bc, br, t) - thinkingLevel(ac, ar, t),
    );
    const [brightest = [0, 0], dimmest = [0, 0]] = [byLevel[0], byLevel.at(-1)];

    const frame = frames.render(t, 0);

    assert.isAbove(thinkingLevel(...brightest, t), 0.9);
    assert.isAbove(pixelAt(frame, ledCenter(...brightest)).red, OFF[0] + 0.9 * (GREY[0] - OFF[0]));
    assert.isBelow(pixelAt(frame, ledCenter(...dimmest)).red, OFF[0] + 0.75 * (GREY[0] - OFF[0]));
    assert.equal(pixelAt(frame, [0.1, 0.9]).red, OFF[0]);
  });

  it("runs colour through the bolt while thinking and settles on the build's own", () => {
    const { lit, unlit } = iconPair(YELLOW);
    const frames = makeLaunchIconFrames(lit, unlit, SIZE, lit);
    const colours = (glow: number) => {
      const frame = frames.render(2.4, glow);
      return BOLT_CELLS.map(([c, r]) => pixelAt(frame, ledCenter(c, r)));
    };

    assert.isTrue(colours(0).some(({ blue, red }) => blue > red));
    assert.isTrue(colours(1).every(({ blue, red }) => red - blue === YELLOW[2] - YELLOW[0]));
  });
});
