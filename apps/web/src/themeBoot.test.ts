import { describe, expect, it, vi } from "vite-plus/test";
import {
  BUILT_IN_THEMES,
  SUPATERM_LIGHT_THEME_COLORS,
  SUPATERM_DARK_THEME_COLORS,
} from "@supaterm/shared/themePalettes";

import indexHtml from "../index.html?raw";
import {
  CUSTOM_THEMES_STORAGE_KEY,
  getStandardThemeColors,
  getThemeDefinition,
  invalidateCustomThemes,
  isKnownThemePreference,
  resolveThemeAppearance,
  THEME_APPEARANCE_MODE_STORAGE_KEY,
  toCanonicalThemeColor,
} from "./themePalette";

const THEME_STORAGE_KEY = "supaterm:theme";
const DEFAULT_DARK_CHROME = getStandardThemeColors("dark").chrome;
const DRACULA = getThemeDefinition("dracula")!;
const CATPPUCCIN_LATTE = getThemeDefinition("catppuccin-latte")!;

const bootScript = (() => {
  const match = indexHtml.match(/<script>([\s\S]*?)<\/script>/);
  if (!match?.[1]) throw new Error("Could not find the inline boot script in index.html");
  return match[1];
})();

type BootResult = {
  isDark: boolean;
  themeId: string | undefined;
  themeSelected: string | undefined;
  backgroundColor: string;
  bootVariables: Record<string, string>;
  metaContent: string | null;
};

function runBootScript(options: {
  storage?: Record<string, string>;
  storageThrows?: boolean;
  prefersDark: boolean;
}): BootResult {
  const classes = new Set<string>();
  const bootVariables: Record<string, string> = {};
  const meta = {
    content: null as string | null,
    setAttribute(_name: string, value: string) {
      this.content = value;
    },
  };
  const documentElement = {
    dataset: {} as Record<string, string | undefined>,
    classList: {
      add: (name: string) => void classes.add(name),
      remove: (name: string) => void classes.delete(name),
      toggle: (name: string, force?: boolean) => {
        const next = force ?? !classes.has(name);
        if (next) classes.add(name);
        else classes.delete(name);
        return next;
      },
    },
    style: {
      backgroundColor: "",
      setProperty: (name: string, value: string) => {
        bootVariables[name] = value;
      },
    },
  };
  const fakeDocument = {
    documentElement,
    querySelectorAll: (selector: string) => (selector === 'meta[name="theme-color"]' ? [meta] : []),
  };
  const fakeWindow = {
    localStorage: {
      getItem: (key: string): string | null => {
        if (options.storageThrows) throw new Error("storage blocked");
        return options.storage?.[key] ?? null;
      },
    },
    matchMedia: () => ({ matches: options.prefersDark }),
  };

  const fakeCss = {
    supports: (property: string, value: string) =>
      property === "color" && toCanonicalThemeColor(value) !== null,
  };

  new Function("window", "document", "CSS", bootScript)(fakeWindow, fakeDocument, fakeCss);

  return {
    isDark: classes.has("dark"),
    themeId: documentElement.dataset.themeId,
    themeSelected: documentElement.dataset.themeSelected,
    backgroundColor: documentElement.style.backgroundColor,
    bootVariables,
    metaContent: meta.content,
  };
}

function runtimeResolvedAppearance(
  storage: Record<string, string>,
  prefersDark: boolean,
): "light" | "dark" {
  vi.stubGlobal("window", {
    localStorage: { getItem: (key: string) => storage[key] ?? null },
    matchMedia: () => ({ matches: prefersDark }),
  });
  invalidateCustomThemes();
  try {
    const raw = storage[THEME_STORAGE_KEY] ?? null;
    const theme = raw !== null && isKnownThemePreference(raw) ? raw : "system";
    const appearanceRaw = storage[THEME_APPEARANCE_MODE_STORAGE_KEY] ?? null;
    const appearanceMode =
      appearanceRaw === "light" || appearanceRaw === "dark" || appearanceRaw === "system"
        ? appearanceRaw
        : theme === "system"
          ? "system"
          : null;
    const followSystem = appearanceMode === "system";
    return resolveThemeAppearance(theme, prefersDark, followSystem, appearanceMode ?? undefined);
  } finally {
    vi.unstubAllGlobals();
    invalidateCustomThemes();
  }
}

const AURORA_DUAL = {
  id: "aurora",
  label: "Aurora",
  appearance: "light",
  colors: { canvas: "#f8fbff", text: "#10243d", accent: "#5b6cff" },
  variants: { dark: { canvas: "#101827", text: "#eef5ff", accent: "#7c93ff" } },
};
const CHARCOAL_DARK_ONLY = {
  id: "charcoal",
  label: "Charcoal",
  appearance: "dark",
  colors: { canvas: "#1c1210", text: "#ffe8d9", accent: "#ff7a45" },
};

describe("index.html boot script", () => {
  const parityCases: ReadonlyArray<{
    name: string;
    storage: Record<string, string>;
    prefersDark: boolean;
  }> = [
    { name: "no stored preference on a dark OS", storage: {}, prefersDark: true },
    {
      name: "a dark-only built-in stays dark on a light OS",
      storage: { [THEME_STORAGE_KEY]: "dracula", [THEME_APPEARANCE_MODE_STORAGE_KEY]: "system" },
      prefersDark: false,
    },
    {
      name: "an explicit light mode cannot lighten a dark-only built-in",
      storage: {
        [THEME_STORAGE_KEY]: "dracula",
        [THEME_APPEARANCE_MODE_STORAGE_KEY]: "light",
      },
      prefersDark: false,
    },
    {
      name: "a light-only built-in stays light on a dark OS",
      storage: {
        [THEME_STORAGE_KEY]: "catppuccin-latte",
        [THEME_APPEARANCE_MODE_STORAGE_KEY]: "system",
      },
      prefersDark: true,
    },
    {
      name: "a retired built-in falls back to system",
      storage: { [THEME_STORAGE_KEY]: "grove", [THEME_APPEARANCE_MODE_STORAGE_KEY]: "system" },
      prefersDark: true,
    },
    {
      name: "a dual-mode custom theme follows the OS",
      storage: {
        [THEME_STORAGE_KEY]: "aurora",
        [THEME_APPEARANCE_MODE_STORAGE_KEY]: "system",
        [CUSTOM_THEMES_STORAGE_KEY]: JSON.stringify([AURORA_DUAL]),
      },
      prefersDark: true,
    },
    {
      name: "a dark-only custom theme stays dark on a light OS",
      storage: {
        [THEME_STORAGE_KEY]: "charcoal",
        [THEME_APPEARANCE_MODE_STORAGE_KEY]: "system",
        [CUSTOM_THEMES_STORAGE_KEY]: JSON.stringify([CHARCOAL_DARK_ONLY]),
      },
      prefersDark: false,
    },
    {
      name: "a removed custom theme falls back to system",
      storage: { [THEME_STORAGE_KEY]: "gone-theme" },
      prefersDark: true,
    },
    {
      name: "a corrupted appearance mode falls back to inference",
      storage: { [THEME_STORAGE_KEY]: "system", [THEME_APPEARANCE_MODE_STORAGE_KEY]: "1" },
      prefersDark: true,
    },
    {
      name: "an explicit light mode keeps a light preference on a dark OS",
      storage: { [THEME_STORAGE_KEY]: "light", [THEME_APPEARANCE_MODE_STORAGE_KEY]: "light" },
      prefersDark: true,
    },
    {
      name: "a bare dark preference stays dark on a light OS",
      storage: { [THEME_STORAGE_KEY]: "dark" },
      prefersDark: false,
    },
  ];

  it.each(parityCases)("matches the runtime appearance: $name", ({ storage, prefersDark }) => {
    const boot = runBootScript({ storage, prefersDark });
    expect(boot.isDark).toBe(runtimeResolvedAppearance(storage, prefersDark) === "dark");
  });

  it.each(["light", "dark"] as const)(
    "boots the standard %s palette without a saved selection",
    (appearance) => {
      const colors =
        appearance === "dark" ? SUPATERM_DARK_THEME_COLORS : SUPATERM_LIGHT_THEME_COLORS;
      const boot = runBootScript({ prefersDark: appearance === "dark" });
      expect(boot.backgroundColor).toBe(colors.chrome);
      expect(boot.metaContent).toBe(colors.chrome);
    },
  );

  it("marks built-in and custom themes on the document element", () => {
    const dracula = runBootScript({
      storage: { [THEME_STORAGE_KEY]: "dracula", [THEME_APPEARANCE_MODE_STORAGE_KEY]: "system" },
      prefersDark: true,
    });
    expect(dracula.themeId).toBe("dracula");
    expect(dracula.themeSelected).toBe("true");
    expect(dracula.isDark).toBe(true);

    const aurora = runBootScript({
      storage: {
        [THEME_STORAGE_KEY]: "aurora",
        [THEME_APPEARANCE_MODE_STORAGE_KEY]: "system",
        [CUSTOM_THEMES_STORAGE_KEY]: JSON.stringify([AURORA_DUAL]),
      },
      prefersDark: true,
    });
    expect(aurora.themeId).toBe("aurora");
    expect(aurora.isDark).toBe(true);
    expect(aurora.backgroundColor).toBe(DEFAULT_DARK_CHROME);
    expect(aurora.bootVariables["--boot-background"]).toBe(AURORA_DUAL.variants.dark.canvas);
    expect(aurora.metaContent).toBe(DEFAULT_DARK_CHROME);
  });

  it("accepts exponent-form OKLCH before the runtime mounts", () => {
    const colors = {
      canvas: "oklch(9.5e-1 1e-2 2.8e2)",
      chrome: "oklch(9.4e-1 1e-2 2.8e2)",
      text: "oklch(2e-1 0 0 / 9e-1)",
      accent: "oklch(6.2e-1 0.2 2.8e2)",
    };
    const boot = runBootScript({
      storage: {
        [THEME_STORAGE_KEY]: "scientific",
        [CUSTOM_THEMES_STORAGE_KEY]: JSON.stringify([
          {
            id: "scientific",
            label: "Scientific",
            appearance: "light",
            colors,
          },
        ]),
      },
      prefersDark: false,
    });

    expect(boot.bootVariables["--boot-background"]).toBe(colors.canvas);
    expect(boot.bootVariables["--boot-foreground"]).toBe(colors.text);
    expect(boot.bootVariables["--boot-accent"]).toBe(colors.accent);
    expect(boot.backgroundColor).toBe(colors.chrome);
    expect(boot.metaContent).toBe(colors.chrome);
  });

  it("keeps every built-in boot splash in sync with the real palettes", () => {
    for (const theme of BUILT_IN_THEMES) {
      // Every built-in carries one appearance, so it boots in that mode even
      // when the global mode asks for the other one.
      for (const mode of ["light", "dark"] as const) {
        const boot = runBootScript({
          storage: {
            [THEME_STORAGE_KEY]: theme.id,
            [THEME_APPEARANCE_MODE_STORAGE_KEY]: mode,
          },
          prefersDark: mode === "dark",
        });
        expect(boot.themeId).toBe(theme.id);
        expect(boot.isDark).toBe(theme.appearance === "dark");
        expect(boot.bootVariables["--boot-background"]).toBe(theme.colors.canvas);
        expect(boot.bootVariables["--boot-foreground"]).toBe(theme.colors.text);
        expect(boot.bootVariables["--boot-accent"]).toBe(theme.colors.accent);
        expect(boot.backgroundColor).toBe(theme.colors.chrome);
        expect(boot.metaContent).toBe(theme.colors.chrome);
      }
    }
  });

  it("applies the matching half of an automatic mix to the splash", () => {
    const storage = {
      [THEME_STORAGE_KEY]: "system",
      [THEME_APPEARANCE_MODE_STORAGE_KEY]: "system",
      "supaterm:theme-halves:v1": JSON.stringify({
        light: CATPPUCCIN_LATTE.id,
        dark: DRACULA.id,
      }),
    };

    const dark = runBootScript({ storage, prefersDark: true });
    expect(dark.isDark).toBe(true);
    expect(dark.themeId).toBe(DRACULA.id);
    expect(dark.bootVariables["--boot-background"]).toBe(DRACULA.colors.canvas);

    const light = runBootScript({ storage, prefersDark: false });
    expect(light.isDark).toBe(false);
    expect(light.themeId).toBe(CATPPUCCIN_LATTE.id);
    expect(light.bootVariables["--boot-background"]).toBe(CATPPUCCIN_LATTE.colors.canvas);
  });

  it("lets a dark half go dark when the light-only base cannot", () => {
    const boot = runBootScript({
      storage: {
        [THEME_STORAGE_KEY]: "parchment",
        [THEME_APPEARANCE_MODE_STORAGE_KEY]: "system",
        [CUSTOM_THEMES_STORAGE_KEY]: JSON.stringify([
          {
            id: "parchment",
            label: "Parchment",
            appearance: "light",
            colors: { canvas: "#f8fbff", text: "#10243d", accent: "#5b6cff" },
          },
        ]),
        "supaterm:theme-halves:v1": JSON.stringify({ dark: DRACULA.id }),
      },
      prefersDark: true,
    });
    expect(boot.isDark).toBe(true);
    expect(boot.themeId).toBe(DRACULA.id);
  });

  it("paints the half's splash when the base theme no longer exists", () => {
    const boot = runBootScript({
      storage: {
        [THEME_STORAGE_KEY]: "gone-theme",
        [THEME_APPEARANCE_MODE_STORAGE_KEY]: "system",
        "supaterm:theme-halves:v1": JSON.stringify({ dark: DRACULA.id }),
      },
      prefersDark: true,
    });
    expect(boot.isDark).toBe(true);
    expect(boot.themeId).toBe(DRACULA.id);
    expect(boot.themeSelected).toBe("true");
    expect(boot.bootVariables["--boot-background"]).toBe(DRACULA.colors.canvas);
  });

  it("ignores a mix half that names an unknown theme", () => {
    const boot = runBootScript({
      storage: {
        [THEME_STORAGE_KEY]: "dracula",
        [THEME_APPEARANCE_MODE_STORAGE_KEY]: "system",
        "supaterm:theme-halves:v1": JSON.stringify({ dark: "gone-theme" }),
      },
      prefersDark: true,
    });
    expect(boot.themeId).toBe("dracula");
    expect(boot.isDark).toBe(true);
  });

  it("uses runtime defaults for malformed custom roles", () => {
    const boot = runBootScript({
      storage: {
        [THEME_STORAGE_KEY]: "partial",
        [THEME_APPEARANCE_MODE_STORAGE_KEY]: "system",
        [CUSTOM_THEMES_STORAGE_KEY]: JSON.stringify([
          {
            id: "partial",
            label: "Partial",
            appearance: "dark",
            colors: { canvas: "not-a-color", text: "#fffaff", accent: "nope" },
          },
        ]),
      },
      prefersDark: true,
    });

    expect(boot.themeId).toBe("partial");
    expect(boot.bootVariables["--boot-background"]).toBe(getStandardThemeColors("dark").canvas);
    expect(boot.bootVariables["--boot-foreground"]).toBe("#fffaff");
    expect(boot.bootVariables["--boot-accent"]).toBe(getStandardThemeColors("dark").accent);
    expect(boot.backgroundColor).toBe(DEFAULT_DARK_CHROME);
    expect(boot.metaContent).toBe(DEFAULT_DARK_CHROME);
  });

  it("follows the OS appearance when storage is unavailable", () => {
    const light = runBootScript({ storageThrows: true, prefersDark: false });
    expect(light.isDark).toBe(false);
    expect(light.themeId).toBeUndefined();

    const dark = runBootScript({ storageThrows: true, prefersDark: true });
    expect(dark.isDark).toBe(true);
  });
});
