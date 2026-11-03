import { describe, expect, it } from "vite-plus/test";

import { AutoLevel, WriteHead } from "./voiceMeter";

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

/** How many dots in column `i` are more than half lit. */
const litRows = (meter: WriteHead, i: number) =>
  Array.from({ length: meter.rows }, (_, j) => meter.dots[j * meter.columns + i]!).filter(
    (value) => value > 0.5,
  ).length;

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

describe("WriteHead", () => {
  it("writes the newest level at the right edge and scrolls it left", () => {
    const meter = new WriteHead();
    const head = meter.columns - 1;
    meter.write(-20);
    expect(litRows(meter, head)).toBe(meter.rows);
    expect(litRows(meter, head - 1)).toBe(0);
    meter.write(-120);
    expect(litRows(meter, head)).toBe(0);
    expect(litRows(meter, head - 1)).toBeGreaterThan(0);
  });

  it("lights more rows the louder the voice", () => {
    const quiet = new WriteHead();
    const loud = new WriteHead();
    quiet.write(-42);
    loud.write(-24);
    const head = quiet.columns - 1;
    expect(litRows(quiet, head)).toBeGreaterThan(0);
    expect(litRows(loud, head)).toBeGreaterThan(litRows(quiet, head));
  });

  it("stops changing once silence has scrolled the voice out", () => {
    const meter = new WriteHead();
    meter.write(-20);
    for (let step = 0; step < meter.columns; step++) meter.write(-120);
    expect(meter.write(-120)).toBe(false);
    expect(meter.write(-20)).toBe(true);
  });
});
