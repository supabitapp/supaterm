import { describe, expect, it } from "vite-plus/test";

import { AutoLevel, DotScope } from "./dotScope";

const H = 1 / 240;

/** Syllables peaking at `peak` dB over a room at `room` dB, 4 a second; returns the levels. */
function speak(auto: AutoLevel, peak: number, room: number, seconds: number): Array<number> {
  return Array.from({ length: Math.floor(seconds / H) }, (_, index) => {
    const syllable = Math.max(0, Math.sin(Math.PI * 2 * 4 * index * H));
    return auto.step(room + (peak - room) * Math.sqrt(syllable), H);
  });
}

const high = (levels: ReadonlyArray<number>) =>
  levels.toSorted((a, b) => a - b)[Math.floor((levels.length * 9) / 10)]!;

function run(scope: DotScope, seconds: number, loudness: number): DotScope {
  for (let frame = 0; frame < Math.round(seconds * 60); frame++) scope.advance(1 / 60, loudness);
  return scope;
}

const powers = (scope: DotScope) => scope.dots.filter((_, index) => index % 2 === 0);

const lit = (scope: DotScope) => powers(scope).reduce((sum, power) => sum + power, 0);

/** Mean distance of lit dots from the middle row, in rows. */
function spread(scope: DotScope): number {
  const mid = (scope.rows - 1) / 2;
  let sum = 0;
  let weight = 0;
  powers(scope).forEach((power, n) => {
    sum += power * Math.abs(Math.floor(n / scope.columns) - mid);
    weight += power;
  });
  return sum / Math.max(weight, 1e-6);
}

describe("AutoLevel", () => {
  it("moves a quiet microphone as far as a loud one", () => {
    const quiet = new AutoLevel();
    speak(quiet, -36, -58, 4);
    const loud = new AutoLevel();
    speak(loud, -14, -50, 4);
    expect(high(speak(quiet, -36, -58, 2))).toBeGreaterThan(0.8);
    expect(high(speak(loud, -14, -50, 2))).toBeGreaterThan(0.8);
  });

  it("never boosts the room or silence to full", () => {
    const fan = new AutoLevel();
    speak(fan, -30, -55, 2);
    let last = 1;
    for (let step = 0; step < 20 / H; step++) last = fan.step(-48, H);
    expect(last).toBeLessThan(0.05);
    expect(fan.peak).toBeGreaterThanOrEqual(fan.room + 16 - 0.01);

    const silent = new AutoLevel();
    for (let step = 0; step < 20 / H; step++) last = silent.step(-90, H);
    expect(last).toBe(0);
  });
});

describe("DotScope", () => {
  it("draws a resting braid in silence and widens it with the voice", () => {
    const quiet = run(new DotScope(false), 1.5, -120);
    const loud = run(new DotScope(false), 1.5, -20);
    expect(lit(quiet)).toBeGreaterThan(20);
    expect(spread(loud)).toBeGreaterThan(spread(quiet) * 1.3);
  });

  it("draws the same picture at any frame rate", () => {
    const at60 = new DotScope(false);
    const at120 = new DotScope(false);
    for (let frame = 0; frame < 90; frame++) {
      at60.advance(1 / 60, -25);
      at120.advance(1 / 120, -25);
      at120.advance(1 / 120, -25);
    }
    expect(at120.dots).toEqual(at60.dots);
  });

  it("holds a still braid for reduced motion", () => {
    const scope = run(new DotScope(true), 3, -120);
    const before = scope.dots.slice();
    run(scope, 0.5, -120);
    const drift = Math.max(...scope.dots.map((value, index) => Math.abs(value - before[index]!)));
    expect(drift).toBeLessThan(1e-3);
    expect(lit(scope)).toBeGreaterThan(20);
  });
});
