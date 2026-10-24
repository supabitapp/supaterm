import { describe, expect, it } from "vite-plus/test";
import {
  BUILT_IN_THEME_IDS,
  BUILT_IN_THEMES,
  SUPATERM_LIGHT_THEME_COLORS,
  SUPATERM_DARK_THEME_COLORS,
  MOBILE_THEME_IDS,
  getThemeColorsForAppearance,
} from "@supaterm/shared/themePalettes";
import {
  readDefaultMobileThemeVariables,
  readGeneratedMobileThemeVariables,
} from "./mobileTheme.test-support";
import { getMobileThemeRuntimeVariables } from "./mobileThemeVariables";

import {
  createMobileThemePairPatch,
  createMobileThemeSelectionPatch,
  createMobileThemeVariables,
  DEFAULT_MOBILE_THEME_ID,
  flattenThemeColor,
  getMobileThemePreviewColors,
  mobileThemeSupportsAppearance,
  getMobileThemeVariables,
  normalizeMobileThemeId,
  normalizeMobileThemeMode,
  resolveMobileThemeIds,
  themeColorWithAlpha,
  themeColorToNativeColor,
} from "./mobileTheme";

function relativeLuminance(hex: string): number {
  const channels = themeColorToNativeColor(hex)
    .slice(1)
    .match(/.{2}/g)!
    .map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrastRatio(first: string, second: string): number {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  return (
    (Math.max(firstLuminance, secondLuminance) + 0.05) /
    (Math.min(firstLuminance, secondLuminance) + 0.05)
  );
}

function compositeOver(overlay: string, background: string): string {
  const overlayMatch = /^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/.exec(overlay)!;
  const backgroundChannels = background
    .slice(1)
    .match(/.{2}/g)!
    .map((channel) => Number.parseInt(channel, 16));
  const alpha = Number(overlayMatch[4]);
  const channels = [1, 2, 3].map((index) =>
    Math.round(Number(overlayMatch[index]) * alpha + backgroundChannels[index - 1]! * (1 - alpha)),
  );
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

describe("mobile themes", () => {
  it("declares every runtime theme variable in the static stylesheet", () => {
    const generatedVariables = createMobileThemeVariables(SUPATERM_LIGHT_THEME_COLORS, "light");
    expect(Object.keys(readDefaultMobileThemeVariables("light")).sort()).toEqual(
      Object.keys(generatedVariables).sort(),
    );
    expect(Object.keys(readDefaultMobileThemeVariables("dark")).sort()).toEqual(
      Object.keys(generatedVariables).sort(),
    );
  });

  it.each(MOBILE_THEME_IDS)("uses the web color roles for %s in both appearances", (themeId) => {
    for (const appearance of ["light", "dark"] as const) {
      if (!mobileThemeSupportsAppearance(themeId, appearance)) continue;
      const theme = BUILT_IN_THEMES.find((candidate) => candidate.id === themeId);
      const colors = theme
        ? getThemeColorsForAppearance(theme, appearance)!
        : appearance === "dark"
          ? SUPATERM_DARK_THEME_COLORS
          : SUPATERM_LIGHT_THEME_COLORS;
      const variables =
        themeId === DEFAULT_MOBILE_THEME_ID
          ? readDefaultMobileThemeVariables(appearance)
          : getMobileThemeVariables(themeId, appearance);
      expect(variables["--color-screen"]).toBe(themeColorToNativeColor(colors.canvas));
      expect(variables["--color-thread-canvas"]).toBe(variables["--color-screen"]);
      expect(variables["--color-drawer"]).toBe(themeColorToNativeColor(colors.sidebar));
      expect(variables["--color-thread-hover"]).toBe(
        themeColorToNativeColor(colors.sidebarRowHover),
      );
      expect(variables["--color-card"]).toBe(themeColorToNativeColor(colors.surface));
      expect(variables["--color-composer-surface"]).toBe(
        themeColorWithAlpha(variables["--color-grouped-card"], appearance === "dark" ? 0.9 : 0.94),
      );
      expect(variables["--color-thread-selected"]).toBe(
        themeColorToNativeColor(colors.sidebarRowActive),
      );
      expect(variables["--color-thread-selected-foreground"]).toBe(
        themeColorToNativeColor(colors.sidebarForeground),
      );
      expect(variables["--color-primary"]).toBe(themeColorToNativeColor(colors.messageAction));
      if (themeId !== DEFAULT_MOBILE_THEME_ID) {
        expect(variables["--color-user-bubble"]).toBe(
          themeColorToNativeColor(colors.messageSurface),
        );
      }
      expect(
        contrastRatio(variables["--color-foreground"], variables["--color-screen"]),
      ).toBeGreaterThanOrEqual(4.5);
      for (const [foreground, surface] of [
        ["--color-drawer-foreground", "--color-drawer"],
        ["--color-drawer-foreground-muted", "--color-drawer"],
        ["--color-drawer-foreground", "--color-thread-hover"],
        ["--color-drawer-foreground-muted", "--color-thread-hover"],
        ["--color-thread-selected-foreground-muted", "--color-thread-selected"],
        ["--color-primary-foreground", "--color-primary"],
        ["--color-primary-text", "--color-screen"],
        ["--color-primary-text", "--color-card"],
        ["--color-primary-text", "--color-card-alt"],
        ["--color-primary-text", "--color-sheet-solid"],
        ["--color-foreground", "--color-sheet-solid"],
        ["--color-foreground-muted", "--color-sheet-solid"],
        ["--color-primary-text", "--color-grouped-card"],
        ["--color-foreground", "--color-grouped-card"],
        ["--color-foreground-muted", "--color-grouped-card"],
        ["--color-placeholder", "--color-grouped-card"],
        ["--color-secondary-foreground", "--color-secondary"],
        ["--color-user-bubble-foreground", "--color-user-bubble"],
        ["--color-warning-foreground", "--color-warning"],
        ["--color-danger-foreground", "--color-danger"],
        ["--color-md-body", "--color-screen"],
        ["--color-md-strong", "--color-screen"],
        ["--color-md-link", "--color-screen"],
        ["--color-md-code-text", "--color-md-code-bg"],
      ] as const) {
        expect(
          contrastRatio(variables[foreground], variables[surface]),
          `${appearance}: ${foreground} on ${surface}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
      expect(
        contrastRatio(
          variables["--color-thread-selected-foreground"],
          variables["--color-thread-selected"],
        ),
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(MOBILE_THEME_IDS)("keeps %s sidebar text readable on Android", (themeId) => {
    for (const appearance of ["light", "dark"] as const) {
      if (!mobileThemeSupportsAppearance(themeId, appearance)) continue;
      const variables = getMobileThemeRuntimeVariables(themeId, appearance, "android");
      for (const foreground of [
        "--color-drawer-foreground",
        "--color-drawer-foreground-muted",
      ] as const) {
        expect(
          contrastRatio(variables[foreground], variables["--color-drawer"]),
          `${appearance}: ${foreground}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("applies palette overrides on top of the selected built-in theme", () => {
    const variables = getMobileThemeVariables("nord", "dark", {
      "--color-primary": "#123456",
    });

    expect(variables["--color-primary"]).toBe("#123456");
    expect(variables["--color-screen"]).toMatch(/^#/);
  });

  it.each(MOBILE_THEME_IDS)("separates %s filled groups from their sheets", (themeId) => {
    for (const appearance of ["light", "dark"] as const) {
      if (!mobileThemeSupportsAppearance(themeId, appearance)) continue;
      const generated = readGeneratedMobileThemeVariables(
        themeId === DEFAULT_MOBILE_THEME_ID ? appearance : `${themeId}-${appearance}`,
      );
      expect(generated).toEqual(getMobileThemeVariables(themeId, appearance));
      for (const platform of ["ios", "android"]) {
        const variables = getMobileThemeRuntimeVariables(themeId, appearance, platform);
        const sheet = variables["--color-sheet-solid"];
        const group = variables["--color-grouped-card"];
        expect(
          contrastRatio(group, sheet),
          `${platform} ${appearance}: grouped surface on sheet`,
        ).toBeGreaterThanOrEqual(1.025);
        for (const role of [
          "--color-foreground",
          "--color-foreground-secondary",
          "--color-foreground-muted",
          "--color-placeholder",
          "--color-primary-text",
        ] as const) {
          expect(
            contrastRatio(variables[role], group),
            `${platform} ${appearance}: ${role} on grouped surface`,
          ).toBeGreaterThanOrEqual(4.5);
        }
        if (platform === "android") {
          const header = flattenThemeColor(variables["--color-header"], sheet);
          for (const role of ["--color-header-foreground", "--color-foreground-muted"] as const) {
            expect(
              contrastRatio(variables[role], header),
              `${appearance}: ${role} on Android header`,
            ).toBeGreaterThanOrEqual(4.5);
          }
        }
        expect(
          contrastRatio(variables["--color-foreground-muted"], variables["--color-secondary"]),
          `${platform} ${appearance}: muted label on secondary surface`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("keeps One Light grouped cards distinct from the sheet", () => {
    const variables = getMobileThemeVariables("one-light", "light");
    const group = variables["--color-grouped-card"];
    expect(contrastRatio(group, variables["--color-sheet-solid"])).toBeGreaterThanOrEqual(1.1);
    for (const role of ["--color-foreground", "--color-foreground-muted"] as const) {
      expect(contrastRatio(variables[role], group)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(MOBILE_THEME_IDS)("keeps %s prominent actions readable and themed", (themeId) => {
    for (const appearance of ["light", "dark"] as const) {
      if (!mobileThemeSupportsAppearance(themeId, appearance)) continue;
      const variables = getMobileThemeVariables(themeId, appearance);
      const fill = variables["--color-prominent-action"];
      expect(
        contrastRatio(variables["--color-prominent-action-foreground"], fill),
      ).toBeGreaterThanOrEqual(4.5);
      expect(fill).toBe(
        variables[themeId === DEFAULT_MOBILE_THEME_ID ? "--color-foreground" : "--color-primary"],
      );
    }
  });

  it.each(["light", "dark"] as const)(
    "preserves default %s message colors and separates fallback materials",
    (appearance) => {
      const variables = getMobileThemeVariables("supaterm", appearance);
      const desktop =
        appearance === "dark" ? SUPATERM_DARK_THEME_COLORS : SUPATERM_LIGHT_THEME_COLORS;
      expect(variables["--color-user-bubble"]).toBe(
        themeColorToNativeColor(desktop.messageSurface),
      );
      expect(
        contrastRatio(
          variables["--color-user-bubble-foreground"],
          variables["--color-user-bubble"],
        ),
      ).toBeGreaterThanOrEqual(4.5);
      for (const role of ["--color-composer-surface", "--color-glass-fallback"] as const) {
        const surface = flattenThemeColor(variables[role], variables["--color-screen"]);
        expect(contrastRatio(surface, variables["--color-screen"])).toBeGreaterThanOrEqual(1.06);
        for (const foreground of [
          "--color-foreground",
          "--color-placeholder",
          "--color-primary-text",
        ] as const) {
          expect(contrastRatio(variables[foreground], surface)).toBeGreaterThanOrEqual(4.5);
        }
      }
    },
  );

  it("uses the same preview roles and standard artwork as desktop", () => {
    expect(getMobileThemePreviewColors(DEFAULT_MOBILE_THEME_ID, "light")).toEqual({
      canvas: themeColorToNativeColor(SUPATERM_LIGHT_THEME_COLORS.canvas),
      accent: themeColorToNativeColor(SUPATERM_LIGHT_THEME_COLORS.accent),
      messageAction: themeColorToNativeColor(SUPATERM_LIGHT_THEME_COLORS.messageAction),
    });
    const desktopNord = BUILT_IN_THEMES.find((theme) => theme.id === "nord")!;
    expect(getMobileThemePreviewColors("nord", "dark")).toEqual({
      canvas: themeColorToNativeColor(desktopNord.colors.canvas),
      accent: themeColorToNativeColor(desktopNord.colors.accent),
      messageAction: themeColorToNativeColor(desktopNord.colors.messageAction),
    });
  });

  it("normalizes persisted theme preferences", () => {
    expect(normalizeMobileThemeId("kanagawa-wave")).toBe("kanagawa-wave");
    expect(normalizeMobileThemeId("nord")).toBe("nord");
    expect(normalizeMobileThemeId("missing-theme")).toBe(DEFAULT_MOBILE_THEME_ID);
    expect(normalizeMobileThemeMode("dark")).toBe("dark");
    expect(normalizeMobileThemeMode("sepia")).toBe("system");
  });

  it("resolves independent appearance themes and falls back to the default", () => {
    expect(
      resolveMobileThemeIds({ lightThemeId: "catppuccin-latte", darkThemeId: "nord" }),
    ).toEqual({
      light: "catppuccin-latte",
      dark: "nord",
    });
    expect(resolveMobileThemeIds({ lightThemeId: "missing" })).toEqual({
      light: DEFAULT_MOBILE_THEME_ID,
      dark: DEFAULT_MOBILE_THEME_ID,
    });
  });

  it("changes one appearance theme and keeps the other", () => {
    const themeIds = { light: "one-light", dark: "dracula" } as const;
    expect(createMobileThemeSelectionPatch(themeIds, "dark", "nord")).toEqual({
      lightThemeId: "one-light",
      darkThemeId: "nord",
    });
    expect(createMobileThemeSelectionPatch(themeIds, "light", "catppuccin-latte")).toEqual({
      lightThemeId: "catppuccin-latte",
      darkThemeId: "dracula",
    });
  });

  it("changes only supported appearances from the card action", () => {
    const themeIds = { light: "one-light", dark: "dracula" } as const;
    expect(createMobileThemePairPatch(themeIds, "nord")).toEqual({
      lightThemeId: "one-light",
      darkThemeId: "nord",
    });
    expect(createMobileThemePairPatch(themeIds, "supaterm")).toEqual({
      lightThemeId: "supaterm",
      darkThemeId: "supaterm",
    });
  });

  it("falls back for retired and incompatible saved themes", () => {
    expect(resolveMobileThemeIds({ lightThemeId: "dracula", darkThemeId: "one-light" })).toEqual({
      light: DEFAULT_MOBILE_THEME_ID,
      dark: DEFAULT_MOBILE_THEME_ID,
    });
    for (const themeId of ["supaterm-chat", "grove", "ocean", "ember", "iris", "zenbones"]) {
      expect(normalizeMobileThemeId(themeId)).toBe(DEFAULT_MOBILE_THEME_ID);
    }
  });

  it("ignores a selection without a palette for that appearance", () => {
    const themeIds = { light: "one-light", dark: "nord" } as const;
    expect(createMobileThemeSelectionPatch(themeIds, "light", "dracula")).toEqual({
      lightThemeId: "one-light",
      darkThemeId: "nord",
    });
  });

  it("converts OKLCH colors to React Native sRGB ColorValues", () => {
    expect(themeColorToNativeColor("oklch(1 0 0)")).toBe("#ffffff");
    expect(themeColorToNativeColor("oklch(0 0 0)")).toBe("#000000");
    expect(themeColorToNativeColor("#123456")).toBe("#123456");
  });

  it("maps semantic palette roles onto every mobile color variable", () => {
    const variables = createMobileThemeVariables(SUPATERM_LIGHT_THEME_COLORS, "light");
    expect(variables["--color-sheet-solid"]).toBe(
      themeColorToNativeColor(SUPATERM_LIGHT_THEME_COLORS.chrome),
    );
    expect(variables["--color-warning"]).toBe(
      themeColorToNativeColor(SUPATERM_LIGHT_THEME_COLORS.warningSurface),
    );
    expect(variables["--color-warning-foreground"]).toBe(
      themeColorToNativeColor(SUPATERM_LIGHT_THEME_COLORS.warningForeground),
    );
    expect(variables["--color-primary"]).not.toBe(variables["--color-screen"]);
    expect(variables["--color-primary-shadow"]).toBe("#000000");
    expect(variables["--color-backdrop"]).toBe("rgba(0, 0, 0, 0.22)");
    expect(variables["--color-drawer-shadow"]).toBe("rgba(0, 0, 0, 0.12)");
    expect(variables["--color-user-bubble-foreground"]).toMatch(/^#/);
  });

  it("keeps placeholders and selected-row labels readable on their mobile surfaces", () => {
    for (const themeId of BUILT_IN_THEME_IDS) {
      for (const appearance of ["light", "dark"] as const) {
        if (!mobileThemeSupportsAppearance(themeId, appearance)) continue;
        const variables = getMobileThemeVariables(themeId, appearance);
        expect(
          contrastRatio(variables["--color-placeholder"], variables["--color-input"]),
        ).toBeGreaterThanOrEqual(4.5);
      }
    }

    for (const themeId of BUILT_IN_THEME_IDS) {
      for (const appearance of ["light", "dark"] as const) {
        if (!mobileThemeSupportsAppearance(themeId, appearance)) continue;
        const variables = getMobileThemeVariables(themeId, appearance);
        expect(
          contrastRatio(
            variables["--color-user-bubble-foreground"],
            variables["--color-user-bubble"],
          ),
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          contrastRatio(
            variables["--color-user-bubble-skill-foreground"],
            variables["--color-user-bubble"],
          ),
        ).toBeGreaterThanOrEqual(4.5);
        expect(variables["--color-user-bubble-skill-foreground"]).not.toBe(
          variables["--color-user-bubble-foreground"],
        );
        const fenceSurface = compositeOver(
          variables["--color-md-user-fence-bg"],
          variables["--color-user-bubble"],
        );
        expect(fenceSurface).not.toBe(variables["--color-user-bubble"]);
        expect(
          contrastRatio(variables["--color-md-user-fence-text"], fenceSurface),
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("keeps the default user bubble readable in both appearances", () => {
    for (const appearance of ["light", "dark"] as const) {
      const variables = readDefaultMobileThemeVariables(appearance);
      const bubble = variables["--color-user-bubble"];
      expect(
        contrastRatio(variables["--color-user-bubble-foreground"], bubble),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(variables["--color-user-bubble-skill-foreground"], bubble),
      ).toBeGreaterThanOrEqual(4.5);
      expect(variables["--color-user-bubble-skill-foreground"]).not.toBe(
        variables["--color-user-bubble-foreground"],
      );
      const fenceSurface = compositeOver(variables["--color-md-user-fence-bg"], bubble);
      expect(fenceSurface).not.toBe(bubble);
      expect(
        contrastRatio(variables["--color-md-user-fence-text"], fenceSurface),
      ).toBeGreaterThanOrEqual(4.5);
      const codeSurface = compositeOver(variables["--color-md-user-code-bg"], bubble);
      expect(
        contrastRatio(variables["--color-md-user-code-text"], codeSurface),
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});
