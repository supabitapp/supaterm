import { DEFAULT_SERVER_SETTINGS, ProviderInstanceId } from "@supaterm/contracts";
import { DEFAULT_CLIENT_SETTINGS, type ClientSettings } from "@supaterm/contracts/settings";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const persistenceMocks = vi.hoisted(() => {
  const state = {
    pendingReads: [] as Array<() => Promise<ClientSettings | null>>,
    pendingWrites: [] as Array<(settings: ClientSettings) => Promise<void>>,
    read: () => Promise.resolve<ClientSettings | null>(null),
    getClientSettings: vi.fn<() => void>(),
    setClientSettings: vi.fn<(settings: ClientSettings) => void>(),
    persistence: {
      getClientSettings: () => {
        state.getClientSettings();
        return (state.pendingReads.shift() ?? state.read)();
      },
      setClientSettings: (settings: ClientSettings) => {
        state.setClientSettings(settings);
        return (state.pendingWrites.shift() ?? (() => Promise.resolve()))(settings);
      },
    },
  };
  return state;
});

vi.mock("~/localApi", () => ({
  ensureLocalApi: () => ({ persistence: persistenceMocks.persistence }),
}));

function recordingPersist(...outcomes: Array<(settings: ClientSettings) => Promise<void>>) {
  const calls: Array<ClientSettings> = [];
  const persist = (settings: ClientSettings) => {
    calls.push(settings);
    return (outcomes.length > 1 ? outcomes.shift()! : outcomes[0]!)(settings);
  };
  return { calls, persist };
}

import {
  __resetClientSettingsPersistenceForTests,
  __setClientSettingsForTests,
  ensureClientSettingsHydrated,
  getClientSettings,
  mergeEnvironmentSettings,
  persistClientSettingsPatch,
  persistClientSettingsUpdate,
} from "./useSettings";

beforeEach(() => {
  persistenceMocks.getClientSettings.mockReset();
  persistenceMocks.setClientSettings.mockReset();
  persistenceMocks.pendingReads.length = 0;
  persistenceMocks.pendingWrites.length = 0;
  persistenceMocks.read = () => Promise.resolve(null);
  __resetClientSettingsPersistenceForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("client settings hydration", () => {
  const savedSettings = {
    ...DEFAULT_CLIENT_SETTINGS,
    timestampFormat: "12-hour" as const,
  };
  const onboardingCompletedAt = "2026-09-05T12:00:00.000Z";
  const complete = (current: ClientSettings) => ({ ...current, onboardingCompletedAt });

  it("rejects completion after a failed read and preserves saved preferences on retry", async () => {
    const failure = new Error("storage unavailable");
    persistenceMocks.pendingReads.push(() => Promise.reject(failure));
    persistenceMocks.read = () => Promise.resolve(savedSettings);

    await expect(persistClientSettingsUpdate(complete)).rejects.toBe(failure);
    expect(persistenceMocks.setClientSettings).not.toHaveBeenCalled();
    expect(getClientSettings()).toBe(DEFAULT_CLIENT_SETTINGS);

    const completedSettings = { ...savedSettings, onboardingCompletedAt };
    await expect(persistClientSettingsUpdate(complete)).resolves.toEqual(completedSettings);
    expect(persistenceMocks.setClientSettings).toHaveBeenCalledExactlyOnceWith(completedSettings);
    expect(persistenceMocks.getClientSettings).toHaveBeenCalledTimes(2);
  });

  it("holds patches until a pending read supplies the saved preferences", async () => {
    let finishRead!: (settings: ClientSettings) => void;
    persistenceMocks.pendingReads.push(
      () =>
        new Promise((resolve) => {
          finishRead = resolve;
        }),
    );
    const persisted = new Promise<ClientSettings>((resolve) => {
      persistenceMocks.pendingWrites.push(async (settings) => {
        resolve(settings);
      });
    });

    const hydration = ensureClientSettingsHydrated();
    persistClientSettingsPatch({ wordWrap: false });
    expect(getClientSettings()).toBe(DEFAULT_CLIENT_SETTINGS);
    expect(persistenceMocks.setClientSettings).not.toHaveBeenCalled();

    finishRead(savedSettings);
    await hydration;
    await expect(persisted).resolves.toEqual({ ...savedSettings, wordWrap: false });
    expect(persistenceMocks.getClientSettings).toHaveBeenCalledOnce();
  });

  it("computes a function patch from the saved preferences once they are read", async () => {
    const saved = {
      ...DEFAULT_CLIENT_SETTINGS,
      codexMicro: { ...DEFAULT_CLIENT_SETTINGS.codexMicro, enabled: true },
    };
    persistenceMocks.read = () => Promise.resolve(saved);
    const persisted = new Promise<ClientSettings>((resolve) => {
      persistenceMocks.pendingWrites.push(async (settings) => {
        resolve(settings);
      });
    });

    void persistClientSettingsPatch((current) => ({
      codexMicro: { ...current.codexMicro, brightness: 40 },
    }));

    await expect(persisted).resolves.toEqual({
      ...saved,
      codexMicro: { ...saved.codexMicro, brightness: 40 },
    });
  });

  it("preserves patch order across hydration and a blocked completion write", async () => {
    let finishRead!: (settings: ClientSettings) => void;
    const read = new Promise<ClientSettings>((resolve) => {
      finishRead = resolve;
    });
    persistenceMocks.read = () => read;
    let finishCompletionWrite!: () => void;
    const blockedWrite = new Promise<void>((resolve) => {
      finishCompletionWrite = resolve;
    });
    let signalCompletionWrite!: () => void;
    const completionWriteStarted = new Promise<void>((resolve) => {
      signalCompletionWrite = resolve;
    });
    let durableSettings: ClientSettings = savedSettings;
    const { persist } = recordingPersist(
      async (settings) => {
        signalCompletionWrite();
        await blockedWrite;
        durableSettings = settings;
      },
      async (settings) => {
        durableSettings = settings;
      },
    );

    const completion = persistClientSettingsUpdate(complete, persist);
    persistClientSettingsPatch({ wordWrap: false }, persist);
    finishRead(savedSettings);
    await completionWriteStarted;
    persistClientSettingsPatch({ wordWrap: true }, persist);
    const finalWrite = persistClientSettingsUpdate((current) => current, persist);

    finishCompletionWrite();
    await completion;
    await finalWrite;

    const expected = { ...savedSettings, onboardingCompletedAt, wordWrap: true };
    expect(getClientSettings()).toEqual(expected);
    expect(durableSettings).toEqual(expected);
  });
});

describe("persistClientSettingsPatch", () => {
  it("waits for settings writes in request order", async () => {
    __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS);
    let finishFirst!: () => void;
    let markFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    persistenceMocks.pendingWrites.push(() => {
      markFirstStarted();
      return new Promise<void>((resolve) => {
        finishFirst = resolve;
      });
    });

    const firstSettings = { ...DEFAULT_CLIENT_SETTINGS, snapShotFlash: false };
    const secondSettings = { ...firstSettings, snapShotPlaySound: false };
    const first = persistClientSettingsPatch({ snapShotFlash: false });
    await firstStarted;
    const second = persistClientSettingsPatch({ snapShotPlaySound: false });

    expect(persistenceMocks.setClientSettings).toHaveBeenCalledTimes(1);
    expect(getClientSettings()).toEqual(secondSettings);
    finishFirst();
    await Promise.all([first, second]);

    expect(persistenceMocks.setClientSettings).toHaveBeenNthCalledWith(1, firstSettings);
    expect(persistenceMocks.setClientSettings).toHaveBeenNthCalledWith(2, secondSettings);
  });

  it("keeps a setting another tab saved after this tab loaded", async () => {
    vi.stubGlobal("window", new EventTarget());
    try {
      await ensureClientSettingsHydrated();
      const otherTabSettings = { ...DEFAULT_CLIENT_SETTINGS, timestampFormat: "12-hour" as const };
      persistenceMocks.read = () => Promise.resolve(otherTabSettings);
      window.dispatchEvent(
        Object.assign(new Event("storage"), { key: "supaterm:client-settings:v1" }),
      );

      await persistClientSettingsPatch({ wordWrap: false });

      expect(persistenceMocks.setClientSettings).toHaveBeenLastCalledWith({
        ...otherTabSettings,
        wordWrap: false,
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("persistClientSettingsUpdate", () => {
  it("publishes the update only after persistence succeeds", async () => {
    let finishPersistence!: () => void;
    const persistence = new Promise<void>((resolve) => {
      finishPersistence = resolve;
    });
    const setClientSettings = () => persistence;
    __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS);

    const pending = persistClientSettingsUpdate(
      (current) => ({
        ...current,
        timestampFormat: "12-hour",
      }),
      setClientSettings,
    );

    expect(getClientSettings().timestampFormat).toBe(DEFAULT_CLIENT_SETTINGS.timestampFormat);
    finishPersistence();
    await expect(pending).resolves.toMatchObject({ timestampFormat: "12-hour" });
    expect(getClientSettings().timestampFormat).toBe("12-hour");
  });

  it("preserves an optimistic write made while an awaited update persists", async () => {
    let finishFirstPersistence!: () => void;
    let durableSettings = DEFAULT_CLIENT_SETTINGS;
    const firstPersistence = new Promise<void>((resolve) => {
      finishFirstPersistence = resolve;
    });
    const { calls, persist } = recordingPersist(
      (settings) =>
        firstPersistence.then(() => {
          durableSettings = settings;
        }),
      async (settings) => {
        durableSettings = settings;
      },
    );
    __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS);
    const importedProfile = { id: "profile-import", name: "Imported", kind: "persistent" as const };

    const pending = persistClientSettingsUpdate(
      (current) => ({
        ...current,
        browserProfiles: [...current.browserProfiles, importedProfile],
      }),
      persist,
    );
    await Promise.resolve();
    const patch = persistClientSettingsPatch({ wordWrap: false }, persist);
    finishFirstPersistence();
    await Promise.all([pending, patch]);

    expect(calls).toHaveLength(3);
    expect(calls[1]).toMatchObject({
      wordWrap: false,
    });
    expect(calls[1]?.browserProfiles).toContainEqual(importedProfile);
    expect(durableSettings.wordWrap).toBe(false);
    expect(durableSettings.browserProfiles).toContainEqual(importedProfile);
    expect(getClientSettings().wordWrap).toBe(false);
    expect(getClientSettings().browserProfiles).toContainEqual(importedProfile);
  });
});

describe("mergeEnvironmentSettings", () => {
  it("keeps server settlement settings when legacy client data contains retired keys", () => {
    const serverSettings = {
      ...DEFAULT_SERVER_SETTINGS,
      sidebarAutoMarkDoneAfterDays: 14,
      sidebarAutoMarkDoneOnMerge: false,
    };
    const legacyClientSettings = {
      ...DEFAULT_CLIENT_SETTINGS,
      sidebarAutoMarkDoneAfterDays: 1,
      sidebarAutoMarkDoneOnMerge: true,
    };

    const settings = mergeEnvironmentSettings(serverSettings, legacyClientSettings);

    expect(settings.sidebarAutoMarkDoneAfterDays).toBe(14);
    expect(settings.sidebarAutoMarkDoneOnMerge).toBe(false);
  });
});

describe("onboarding completion persistence", () => {
  it("keeps onboarding incomplete after a failed save and preserves preferences on retry", async () => {
    const failure = new Error("disk full");
    const { calls, persist } = recordingPersist(
      () => Promise.reject(failure),
      () => Promise.resolve(),
    );
    const existingSettings = {
      ...DEFAULT_CLIENT_SETTINGS,
      timestampFormat: "12-hour" as const,
      favorites: [
        {
          provider: ProviderInstanceId.make("codex_work"),
          model: "gpt-5.6",
        },
      ],
    };
    __setClientSettingsForTests(existingSettings);
    const onboardingCompletedAt = "2026-09-01T12:00:00.000Z";
    const complete = (current: typeof DEFAULT_CLIENT_SETTINGS) => ({
      ...current,
      onboardingCompletedAt,
    });

    await expect(persistClientSettingsUpdate(complete, persist)).rejects.toBe(failure);
    expect(getClientSettings()).toBe(existingSettings);
    expect(getClientSettings().onboardingCompletedAt).toBeNull();

    const completedSettings = { ...existingSettings, onboardingCompletedAt };
    await expect(persistClientSettingsUpdate(complete, persist)).resolves.toEqual(
      completedSettings,
    );
    expect(getClientSettings()).toEqual(completedSettings);
    expect(calls.at(-1)).toEqual(completedSettings);
  });
});
