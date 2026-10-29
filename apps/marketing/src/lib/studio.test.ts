import { describe, expect, it } from "vite-plus/test";

import { DEFAULT_SETTINGS } from "./boltComputer/mount";
import { searchFromSettings, settingsFromSearch } from "./studio";

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
