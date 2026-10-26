import { describe, expect, it } from "vite-plus/test";

import { getMobileThemeVariables, themeColorWithAlpha } from "./mobileTheme";
import { getMobileThemeRuntimeVariables } from "./mobileThemeVariables";

describe("mobile theme runtime variables", () => {
  it("uses the same shared palette source as generated custom themes", () => {
    expect(getMobileThemeRuntimeVariables("one-light", "light", "ios")).toEqual(
      getMobileThemeVariables("one-light", "light"),
    );
    expect(getMobileThemeRuntimeVariables("catppuccin-mocha", "dark", "ios")).toEqual(
      getMobileThemeVariables("catppuccin-mocha", "dark"),
    );
  });

  it.each(["supaterm", "material-you"] as const)(
    "keeps the %s default Material frame distinct in both appearances",
    (themeId) => {
      for (const appearance of ["light", "dark"] as const) {
        const variables = getMobileThemeRuntimeVariables(themeId, appearance, "android");
        expect(variables["--color-header"]).toBe(
          appearance === "light" ? "rgba(236, 236, 239, 1)" : "rgba(42, 43, 49, 1)",
        );
        for (const pane of ["--color-screen", "--color-sheet-solid", "--color-drawer"] as const) {
          expect(variables["--color-header"]).not.toBe(themeColorWithAlpha(variables[pane], 1));
        }
      }
    },
  );

  it.each(["supaterm", "material-you"] as const)(
    "adapts %s iPad chrome without reversing the dark desktop hierarchy",
    (themeId) => {
      for (const appearance of ["light", "dark"] as const) {
        const ios = getMobileThemeRuntimeVariables(themeId, appearance, "ios");
        const android = getMobileThemeRuntimeVariables(themeId, appearance, "android");
        if (appearance === "light") {
          expect(ios["--color-drawer"]).toBe(android["--color-header"]);
          expect(ios["--color-header"]).toBe(android["--color-header"]);
          expect(ios["--color-header-foreground"]).toBe(ios["--color-drawer-foreground"]);
        } else {
          expect(ios).toEqual(getMobileThemeVariables("supaterm", appearance));
          expect(ios["--color-drawer"]).toBe("#18191c");
          expect(ios["--color-thread-canvas"]).toBe("#1d1e22");
        }
        expect(themeColorWithAlpha(ios["--color-thread-hover"], 1)).not.toBe(
          themeColorWithAlpha(ios["--color-drawer"], 1),
        );
        expect(themeColorWithAlpha(ios["--color-thread-hover"], 1)).not.toBe(
          themeColorWithAlpha(ios["--color-thread-selected"], 1),
        );
        for (const role of [
          "--color-screen",
          "--color-thread-canvas",
          "--color-card",
          "--color-composer-surface",
          "--color-grouped-card",
        ] as const) {
          expect(ios[role]).toBe(android[role]);
        }
      }
    },
  );
});
