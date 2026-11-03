import { describe, expect, it } from "vite-plus/test";

import { WriteHead } from "./voiceMeter";

/** How many dots in column `i` are more than half lit. */
const litRows = (meter: WriteHead, i: number) =>
  Array.from({ length: meter.rows }, (_, j) => meter.dots[j * meter.columns + i]!).filter(
    (value) => value > 0.5,
  ).length;

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
