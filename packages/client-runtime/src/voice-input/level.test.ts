import { describe, expect, it } from "vite-plus/test";

import { voiceLevelFromDecibels } from "./level.ts";

describe("voiceLevelFromDecibels", () => {
  it.each([
    { reading: undefined, level: 0 },
    { reading: Number.NaN, level: 0 },
    { reading: Number.NEGATIVE_INFINITY, level: 0 },
    { reading: -160, level: 0 },
    { reading: -55, level: 0 },
    { reading: -32.5, level: 0.5 },
    { reading: -10, level: 1 },
    { reading: 0, level: 1 },
  ])("maps $reading dBFS to $level", ({ reading, level }) => {
    expect(voiceLevelFromDecibels(reading)).toBe(level);
  });
});
