import { describe, expect, it } from "vite-plus/test";

import registeredThemeNames from "../../generated-uniwind-theme-names.json";
import {
  createMobileThemeRuntimeOperations,
  getMobileUniwindThemeName,
  type MobileThemeRuntimeState,
} from "./mobileThemeRuntime";

const initialState: MobileThemeRuntimeState = {
  baseFontSize: 16,
  themeAppearance: "light",
  themeMode: "system",
};

describe("mobileThemeRuntime", () => {
  it("maps custom palettes and appearances to registered themes", () => {
    expect(getMobileUniwindThemeName("nord", "dark")).toBe("nord-dark");
    expect(getMobileUniwindThemeName("nord", "light")).toBe("light");
    expect(getMobileUniwindThemeName("one-light", "dark")).toBe("dark");
  });

  it("hydrates text variables and clears the native appearance override", () => {
    const operations = createMobileThemeRuntimeOperations(null, initialState);
    const variableOperations = operations.filter(
      (operation) => operation.kind === "update-text-variables",
    );

    expect(variableOperations.map((operation) => operation.themeName)).toEqual([
      "light",
      "dark",
      ...registeredThemeNames,
    ]);
    expect(operations.at(-1)).toEqual({
      kind: "set-appearance-mode",
      appearance: "light",
      themeMode: "system",
    });
  });

  it("lets system appearance changes flow through the root ScopedTheme only", () => {
    const operations = createMobileThemeRuntimeOperations(initialState, {
      ...initialState,
      themeAppearance: "dark",
    });

    expect(operations).toEqual([]);
  });

  it("updates text variables for every theme without switching palettes", () => {
    const operations = createMobileThemeRuntimeOperations(initialState, {
      ...initialState,
      baseFontSize: 18,
    });

    expect(operations.every((operation) => operation.kind === "update-text-variables")).toBe(true);
    expect(
      operations
        .filter((operation) => operation.kind === "update-text-variables")
        .map((operation) => operation.themeName),
    ).toEqual(["light", "dark", ...registeredThemeNames]);
  });
});
