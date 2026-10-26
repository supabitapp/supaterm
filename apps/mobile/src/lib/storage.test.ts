import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => {
  const values = new Map<string, string>();
  let preferencesJson: string | null = null;
  let preferencesUpdatedAt = 0;
  let loadPreferencesFails = false;
  let savePreferencesFails = false;
  return {
    clear: () => {
      values.clear();
      preferencesJson = null;
      preferencesUpdatedAt = 0;
      loadPreferencesFails = false;
      savePreferencesFails = false;
    },
    getStoredValue: (key: string) => values.get(key) ?? null,
    getPreferencesJson: () => preferencesJson,
    setPreferencesJson: (value: string, updatedAt: number) => {
      preferencesJson = value;
      preferencesUpdatedAt = updatedAt;
    },
    setDatabaseFailures: (load: boolean, save: boolean) => {
      loadPreferencesFails = load;
      savePreferencesFails = save;
    },
    getItemAsync: vi.fn((key: string) => Promise.resolve(values.get(key) ?? null)),
    setItemAsync: vi.fn((key: string, value: string) => {
      values.set(key, value);
      return Promise.resolve();
    }),
    deleteItemAsync: vi.fn((key: string) => {
      values.delete(key);
      return Promise.resolve();
    }),
    database: {
      closeAsync: vi.fn(() => Promise.resolve()),
      execAsync: vi.fn(() => Promise.resolve()),
      withExclusiveTransactionAsync: vi.fn(
        (
          run: (transaction: {
            execAsync: () => Promise<void>;
            getFirstAsync: () => Promise<{ readonly user_version: number }>;
          }) => Promise<void>,
        ) =>
          run({
            execAsync: () => Promise.resolve(),
            getFirstAsync: () => Promise.resolve({ user_version: 0 }),
          }),
      ),
      getFirstAsync: vi.fn(() => {
        if (loadPreferencesFails) {
          return Promise.reject(new Error("database unavailable"));
        }
        return Promise.resolve(
          preferencesJson === null
            ? null
            : { payload: preferencesJson, updatedAt: preferencesUpdatedAt },
        );
      }),
      runAsync: vi.fn((_sql: string, payload?: unknown, updatedAt?: unknown) => {
        if (savePreferencesFails) {
          return Promise.reject(new Error("database unavailable"));
        }
        if (typeof payload === "string") {
          preferencesJson = payload;
        }
        if (typeof updatedAt === "number") {
          preferencesUpdatedAt = updatedAt;
        }
        return Promise.resolve();
      }),
    },
  };
});

vi.mock("expo", () => ({
  requireOptionalNativeModule: () => null,
}));

vi.mock("expo-secure-store", () => ({
  deleteItemAsync: mocks.deleteItemAsync,
  getItemAsync: mocks.getItemAsync,
  setItemAsync: mocks.setItemAsync,
}));

vi.mock("expo-sqlite", () => ({
  openDatabaseAsync: vi.fn(() => Promise.resolve(mocks.database)),
}));

vi.mock("expo-crypto", () => ({
  getRandomBytes: vi.fn(() => new Uint8Array(16)),
}));

vi.mock("expo-constants", () => ({
  default: { expoConfig: { extra: {} } },
}));

vi.mock("react-native", () => ({
  AppState: { currentState: "active" },
  Platform: {
    OS: "ios",
  },
}));

import { loadPreferences, savePreferencesPatch } from "../persistence/imperative";

describe("mobile storage", () => {
  beforeEach(() => {
    mocks.clear();
    vi.clearAllMocks();
  });

  it("persists independent light and dark theme choices", async () => {
    mocks.setPreferencesJson(
      JSON.stringify({
        lightThemeId: "catppuccin-latte",
        darkThemeId: "nord",
        themeMode: "system",
      }),
      10,
    );

    await expect(loadPreferences()).resolves.toEqual({
      lightThemeId: "catppuccin-latte",
      darkThemeId: "nord",
      themeMode: "system",
    });
  });

  it("persists Material You independently for each appearance", async () => {
    const themes = { lightThemeId: "material-you", darkThemeId: "nord" } as const;
    await savePreferencesPatch(themes);
    await expect(loadPreferences()).resolves.toEqual(themes);
    await savePreferencesPatch({ lightThemeId: "one-light" });
    await expect(loadPreferences()).resolves.toEqual({ ...themes, lightThemeId: "one-light" });
  });

  it("falls back to secure storage when SQLite cannot save preferences", async () => {
    mocks.setDatabaseFailures(true, true);
    await expect(savePreferencesPatch({ baseFontSize: 19 })).resolves.toEqual({ baseFontSize: 19 });
    const fallback = JSON.parse(mocks.getStoredValue("supaterm.preferences.fallback") ?? "") as {
      readonly payload: string;
      readonly updatedAt: number;
    };
    expect(JSON.parse(fallback.payload)).toEqual({ baseFontSize: 19 });
    expect(fallback.updatedAt).toEqual(expect.any(Number));
  });

  it.each(["status", "project"] as const)("persists %s thread grouping", async (threadGrouping) => {
    await savePreferencesPatch({ threadGrouping });
    await expect(loadPreferences()).resolves.toEqual({ threadGrouping });
  });

  it("drops invalid thread grouping without discarding other preferences", async () => {
    mocks.setPreferencesJson(JSON.stringify({ threadGrouping: "unknown", baseFontSize: 17 }), 10);
    await expect(loadPreferences()).resolves.toEqual({ baseFontSize: 17 });
  });

  it("persists collapsed thread list groups and drops non-string keys", async () => {
    await savePreferencesPatch({ threadListCollapsedGroups: ["project:a", "project:b"] });
    await expect(loadPreferences()).resolves.toEqual({
      threadListCollapsedGroups: ["project:a", "project:b"],
    });
    mocks.setPreferencesJson(JSON.stringify({ threadListCollapsedGroups: ["project:a", 1] }), 10);
    await expect(loadPreferences()).resolves.toEqual({ threadListCollapsedGroups: ["project:a"] });
  });

  it("drops invalid thread list shelf expansion preferences", async () => {
    mocks.setPreferencesJson(
      JSON.stringify({
        baseFontSize: 17,
        threadListDoneShelfExpanded: "false",
        threadListSnoozedShelfExpanded: 1,
      }),
      10,
    );

    await expect(loadPreferences()).resolves.toEqual({ baseFontSize: 17 });
  });

  it("reconciles fallback preferences after SQLite recovers", async () => {
    mocks.setPreferencesJson(JSON.stringify({ baseFontSize: 15 }), 10);
    await mocks.setItemAsync(
      "supaterm.preferences.fallback",
      JSON.stringify({
        payload: JSON.stringify({ baseFontSize: 19 }),
        updatedAt: 20,
      }),
    );

    await expect(loadPreferences()).resolves.toEqual({ baseFontSize: 19 });
    expect(JSON.parse(mocks.getPreferencesJson() ?? "")).toEqual({ baseFontSize: 19 });
    expect(mocks.getStoredValue("supaterm.preferences.fallback")).toBeNull();
  });

  it("ignores a stale fallback when its previous deletion failed", async () => {
    mocks.setPreferencesJson(JSON.stringify({ baseFontSize: 21 }), 30);
    await mocks.setItemAsync(
      "supaterm.preferences.fallback",
      JSON.stringify({
        payload: JSON.stringify({ baseFontSize: 19 }),
        updatedAt: 20,
      }),
    );

    await expect(loadPreferences()).resolves.toEqual({ baseFontSize: 21 });
    expect(JSON.parse(mocks.getPreferencesJson() ?? "")).toEqual({ baseFontSize: 21 });
    expect(mocks.getStoredValue("supaterm.preferences.fallback")).toBeNull();
  });
});
