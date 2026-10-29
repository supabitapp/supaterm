import { describe, expect, it } from "vite-plus/test";

import { DEFAULT_SETTINGS } from "./boltComputer/mount";
import { searchFromSettings, settingsFromSearch, withoutAlpha } from "./studio";

describe("studio links", () => {
  it("leave the defaults out", () => {
    expect(searchFromSettings(DEFAULT_SETTINGS)).toBe("");
    expect(settingsFromSearch("")).toEqual(DEFAULT_SETTINGS);
  });

  it("reproduce the settings they were made from", () => {
    const settings = {
      state: "error",
      shell: "#3a3d44",
      phosphor: "#da6aff",
      knobs: "#b8913f",
      controls: false,
      speed: 1.5,
      paused: true,
      interactive: false,
      floorShadow: false,
    } as const;
    expect(settingsFromSearch(searchFromSettings(settings))).toEqual(settings);
  });

  it("keep any speed the slider reaches", () => {
    expect(settingsFromSearch("?speed=0.25").speed).toBe(0.25);
    expect(settingsFromSearch("?speed=0.1").speed).toBe(DEFAULT_SETTINGS.speed);
  });

  it("fall back to the defaults for values the studio cannot show", () => {
    expect(
      settingsFromSearch("?state=dancing&shell=red&phosphor=12345&knobs=olive&speed=3&paused=yes"),
    ).toEqual(DEFAULT_SETTINGS);
  });
});

describe("panel colours", () => {
  it("lose their alpha, which the opaque bolt computer cannot show", () => {
    expect(withoutAlpha("#e2dbca00")).toBe("#e2dbca");
    expect(withoutAlpha("#f008")).toBe("#f00");
    expect(withoutAlpha("oklch(0.7 0.2 145 / 0)")).toBe("oklch(0.7 0.2 145)");
    expect(withoutAlpha("color(display-p3 1 0.35 0.15 / 0.5)")).toBe(
      "color(display-p3 1 0.35 0.15)",
    );
    expect(withoutAlpha("rgb(255 0 0 / 50%)")).toBe("rgb(255 0 0)");
    expect(withoutAlpha("rgba(255, 0, 0, 0)")).toBe("rgb(255, 0, 0)");
    expect(withoutAlpha("hsla(10, 50%, 50%, 0.2)")).toBe("hsl(10, 50%, 50%)");
  });

  it("keep opaque colours as they are", () => {
    expect(withoutAlpha("#e2dbca")).toBe("#e2dbca");
    expect(withoutAlpha("oklch(0.7 0.2 145)")).toBe("oklch(0.7 0.2 145)");
    expect(withoutAlpha("rgb(255, 0, 0)")).toBe("rgb(255, 0, 0)");
  });
});
