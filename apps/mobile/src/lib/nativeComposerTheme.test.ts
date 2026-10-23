import { describe, expect, it } from "vite-plus/test";
import { MOBILE_THEME_IDS } from "@supaterm/shared/themePalettes";

import { getMobileThemeVariables } from "./mobileTheme";
import { createNativeComposerTheme } from "./nativeComposerTheme";

describe("native composer colors", () => {
  it.each(MOBILE_THEME_IDS)("delivers parsable colors for %s in both appearances", (themeId) => {
    for (const appearance of ["light", "dark"] as const) {
      const variables = getMobileThemeVariables(themeId, appearance);
      const theme = createNativeComposerTheme(variables);
      for (const color of Object.values(theme)) expect(color).toMatch(/^#[\da-f]{6}$/i);
      expect(theme.text).toBe(variables["--color-foreground"]);
    }
  });

  it("flattens Material You alpha colors over the composer rather than falling back to defaults", () => {
    const theme = createNativeComposerTheme({
      ...getMobileThemeVariables("supaterm", "light"),
      "--color-screen": "#ffffffff",
      "--color-composer-surface": "#ffffffff",
      "--color-placeholder": "#0000009e",
    });
    expect(theme.placeholder).toBe("#616161");
  });
});
