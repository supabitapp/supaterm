import { describe, expect, it } from "vite-plus/test";

import { VOICE_METER_STEP_MS, WriteHead } from "./voiceMeter";

const STEP = VOICE_METER_STEP_MS / 1000;

/** How many dots in column `i` are more than half lit. */
const litRows = (meter: WriteHead, i: number) =>
  Array.from({ length: meter.rows }, (_, j) => meter.dots[j * meter.columns + i]!).filter(
    (value) => value > 0.5,
  ).length;

/** Writes `seconds` of `loudness` at the meter's step; returns the lit rows of each new column. */
function write(meter: WriteHead, seconds: number, loudness: (time: number) => number) {
  return Array.from({ length: Math.round(seconds / STEP) }, (_, step) => {
    meter.write(loudness(step * STEP));
    return litRows(meter, meter.columns - 1);
  });
}

/** Syllables peaking at `peak` dB over a room at `room` dB, 4 a second. */
const speech = (peak: number, room: number) => (time: number) =>
  room + (peak - room) * Math.sqrt(Math.max(0, Math.sin(Math.PI * 2 * 4 * time)));

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

  it("lights a quiet microphone as fully as a loud one", () => {
    const quiet = new WriteHead();
    write(quiet, 4, speech(-36, -58));
    const loud = new WriteHead();
    write(loud, 4, speech(-14, -50));
    expect(Math.max(...write(quiet, 2, speech(-36, -58)))).toBe(quiet.rows);
    expect(Math.max(...write(loud, 2, speech(-14, -50)))).toBe(loud.rows);
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

  it("leaves a steady room and silence dark", () => {
    const fan = new WriteHead();
    write(fan, 2, speech(-30, -55));
    expect(write(fan, 20, () => -48).at(-1)).toBe(0);
    const silent = new WriteHead();
    expect(Math.max(...write(silent, 20, () => -90))).toBe(0);
  });

  it("stops changing once silence has scrolled the voice out", () => {
    const meter = new WriteHead();
    meter.write(-20);
    for (let step = 0; step < meter.columns; step++) meter.write(-120);
    expect(meter.write(-120)).toBe(false);
    expect(meter.write(-20)).toBe(true);
  });
});
