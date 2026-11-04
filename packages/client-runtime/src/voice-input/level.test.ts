import { describe, expect, it } from "vite-plus/test";

import { voiceLevelFromDecibels } from "./level.ts";

describe("voiceLevelFromDecibels", () => {
  it.each([
    { reading: undefined, level: 0 },
    { reading: Number.NaN, level: 0 },
    { reading: Number.NEGATIVE_INFINITY, level: 0 },
    { reading: -160, level: 0 },
    { reading: 0, level: 1 },
  ])("maps $reading dBFS to $level", ({ reading, level }) => {
    expect(voiceLevelFromDecibels(reading)).toBe(level);
  });

  it("fills most of the meter for normal speech and still moves it for quiet speech", () => {
    expect(voiceLevelFromDecibels(-26)).toBeGreaterThan(0.6);
    expect(voiceLevelFromDecibels(-36)).toBeGreaterThan(0.4);
    expect(voiceLevelFromDecibels(-58)).toBe(0);
  });
});
