import { describe, expect, it } from "vite-plus/test";

import { shouldShowEnvironmentIdentificationPill } from "./environmentIdentification";

describe("shouldShowEnvironmentIdentificationPill", () => {
  it("keeps the pill hidden until client settings hydrate", () => {
    expect(
      shouldShowEnvironmentIdentificationPill({
        settingsHydrated: false,
        appearance: "light",
        paletteThemeActive: true,
      }),
    ).toBe(false);
  });

  it("shows the pill with a custom light palette", () => {
    expect(
      shouldShowEnvironmentIdentificationPill({
        settingsHydrated: true,
        appearance: "light",
        paletteThemeActive: true,
      }),
    ).toBe(true);
  });

  it("hides the pill with the default palette or a dark appearance", () => {
    expect(
      shouldShowEnvironmentIdentificationPill({
        settingsHydrated: true,
        appearance: "light",
        paletteThemeActive: false,
      }),
    ).toBe(false);
    expect(
      shouldShowEnvironmentIdentificationPill({
        settingsHydrated: true,
        appearance: "dark",
        paletteThemeActive: true,
      }),
    ).toBe(false);
  });
});
