import { describe, expect, it } from "vite-plus/test";

import { AutoLevel } from "./autoLevel.ts";

const STEP = 0.08;

/** Steps `seconds` of `loudness` at the meters' 80 ms step; returns each level. */
function run(auto: AutoLevel, seconds: number, loudness: (time: number) => number) {
  return Array.from({ length: Math.round(seconds / STEP) }, (_, step) =>
    auto.step(loudness(step * STEP), STEP),
  );
}

/** Syllables peaking at `peak` dB over a room at `room` dB, 4 a second. */
const speech = (peak: number, room: number) => (time: number) =>
  room + (peak - room) * Math.sqrt(Math.max(0, Math.sin(Math.PI * 2 * 4 * time)));

describe("AutoLevel", () => {
  it("moves a quiet microphone as far as a loud one", () => {
    const quiet = new AutoLevel();
    run(quiet, 4, speech(-36, -58));
    const loud = new AutoLevel();
    run(loud, 4, speech(-14, -50));
    expect(Math.max(...run(quiet, 2, speech(-36, -58)))).toBe(1);
    expect(Math.max(...run(loud, 2, speech(-14, -50)))).toBe(1);
  });

  it("leaves a steady room and silence at zero", () => {
    const fan = new AutoLevel();
    run(fan, 2, speech(-30, -55));
    expect(run(fan, 20, () => -48).at(-1)).toBe(0);
    expect(Math.max(...run(new AutoLevel(), 20, () => -90))).toBe(0);
  });
});
