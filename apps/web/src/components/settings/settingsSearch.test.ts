import { describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId } from "@supaterm/contracts";

import {
  filterAvailableSettingsSearchItems,
  getSettingsSearchTargetScope,
  getThreadAutoMarkDoneSearchAvailability,
  isSettingsSearchScopeAvailable,
  isSettingsSectionAvailable,
  searchSettings,
  SETTINGS_SEARCH_ITEMS,
  type SettingsSearchItem,
} from "./settingsSearch";

const ITEMS: ReadonlyArray<SettingsSearchItem> = [
  {
    id: "word-wrap",
    title: "Word wrap",
    to: "/settings/general",
    searchTerms: ["long lines in code previews"],
  },
  {
    id: "network-access",
    title: "Network access",
    to: "/settings/connections",
    searchTerms: ["remote pairing backend"],
  },
  {
    id: "providers",
    title: "Providers",
    to: "/settings/providers",
    searchTerms: ["claude codex agents"],
  },
  {
    id: "provider-updates",
    title: "Update checks",
    to: "/settings/general",
  },
  {
    id: "automatic-updates",
    title: "Automatic updates",
    to: "/settings/general",
  },
];

describe("searchSettings", () => {
  it("matches titles, sections, and remembered setting details", () => {
    expect(searchSettings("word", ITEMS).map((item) => item.id)).toEqual(["word-wrap"]);
    expect(searchSettings("network", ITEMS).map((item) => item.id)).toEqual(["network-access"]);
    expect(searchSettings("connections", ITEMS).map((item) => item.id)).toEqual(["network-access"]);
    expect(searchSettings("claude", ITEMS).map((item) => item.id)).toEqual(["providers"]);
    expect(searchSettings("long lines", ITEMS).map((item) => item.id)).toEqual(["word-wrap"]);
  });

  it("matches normalized title substrings", () => {
    expect(searchSettings("  WORD   WRAP  ", ITEMS).map((item) => item.id)).toEqual(["word-wrap"]);
    expect(searchSettings("glass").map((item) => item.id)).toEqual(["setting-glass-opacity"]);
    expect(searchSettings("panel animations")).toEqual([]);
    expect(searchSettings("thè\u{1ab0}mes")[0]?.id).toBe("theme");
    const localeLowerCase = vi.spyOn(String.prototype, "toLocaleLowerCase").mockReturnValue("gıt");
    try {
      expect(searchSettings("GIT")[0]?.id).toBe("git-fetch-interval");
      expect(localeLowerCase).not.toHaveBeenCalled();
    } finally {
      localeLowerCase.mockRestore();
    }
    expect(searchSettings("xyzzy")).toEqual([]);
  });

  it("keeps catalog order for multiple title matches", () => {
    expect(searchSettings("update", ITEMS).map((item) => item.id)).toEqual([
      "provider-updates",
      "automatic-updates",
    ]);
  });

  it("matches query words across fields and ranks the strongest result first", () => {
    expect(searchSettings("pairing remote", ITEMS).map((item) => item.id)).toEqual([
      "network-access",
    ]);
    expect(
      searchSettings("remote pairing")
        .slice(0, 3)
        .map((item) => item.id),
    ).toEqual(["network-access", "public-relay", "connections-environment"]);
    expect(searchSettings("encrypted tunnel")[0]?.id).toBe("public-relay");
  });

  it("finds usage providers", () => {
    expect(searchSettings("usage providers")[0]).toMatchObject({
      id: "usage-providers",
      to: "/settings/providers",
    });
  });

  it("hides desktop-only settings from browser search", () => {
    expect(SETTINGS_SEARCH_ITEMS.some((item) => item.id === "quit-confirmation")).toBe(true);
    expect(searchSettings("hold to quit")).toEqual([]);
    expect(searchSettings("wsl")).toEqual([]);
    expect(searchSettings("update track")).toEqual([]);
  });

  it("hides macOS-only settings on other platforms", () => {
    vi.stubGlobal("navigator", { platform: "Win32" });
    try {
      expect(searchSettings("font smoothing")).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("hides settings whose controls are unavailable", () => {
    const available = filterAvailableSettingsSearchItems({
      hasEnvironment: false,
      hasProviderSettingsEnvironment: false,
      hasMacProviderSettingsEnvironment: false,
      canManageLocalBackend: false,
      isWslSettingsRowVisible: false,
      hasThreadAutoMarkDone: false,
    });

    const gatedIds = new Set<string>([
      "follow-change-request-templates",
      "git-fetch-interval",
      "network-access",
      "provider-health-check-interval",
      "cursor-keychain-usage",
      "source-control-writer-model",
      "review-guide-model",
      "review-guide-instructions",
      "source-control-writing-style",
      "tailscale-https",
      "wsl-backend",
      "auto-mark-done-inactive-threads",
      "auto-mark-done-merged-threads",
      "auto-mark-done-keep-pull-requests",
      "days-before-auto-mark-done",
    ]);
    expect(available.map((item) => item.id).filter((id) => gatedIds.has(id))).toEqual([]);
  });

  it("offers Cursor Keychain settings only when a macOS provider environment is available", () => {
    const availability = {
      hasEnvironment: true,
      hasProviderSettingsEnvironment: true,
      hasMacProviderSettingsEnvironment: false,
      canManageLocalBackend: false,
      isWslSettingsRowVisible: false,
      hasThreadAutoMarkDone: false,
    };
    const itemIds = (macAvailable: boolean) =>
      filterAvailableSettingsSearchItems({
        ...availability,
        hasMacProviderSettingsEnvironment: macAvailable,
      }).map((item) => item.id);
    expect(itemIds(false)).not.toContain("cursor-keychain-usage");
    expect(itemIds(false)).not.toContain("usage-providers");
    expect(itemIds(true)).toContain("cursor-keychain-usage");
    expect(itemIds(true)).toContain("usage-providers");
  });

  it("finds keybinding commands by label, command id, and default key", () => {
    expect(searchSettings("toggle sidebar")[0]?.id).toBe("keybinding-sidebar.toggle");
    expect(searchSettings("sidebar.toggle")[0]?.id).toBe("keybinding-sidebar.toggle");
    expect(searchSettings("mod+b")[0]?.id).toBe("keybinding-sidebar.toggle");
    expect(searchSettings("copy link")[0]).toMatchObject({
      id: "keybinding-thread.copyReference",
      to: "/settings/keybindings",
    });
  });

  it("ranks keybinding commands after other settings", () => {
    const ids = searchSettings("model").map((item) => item.id);
    expect(ids[0]).toBe("default-model");
    expect(ids.indexOf("keybinding-modelPicker.toggle")).toBeGreaterThan(
      ids.indexOf("text-generation-model"),
    );
  });

  it("sends commands without a default binding to the section", () => {
    expect(searchSettings("composer.cycleHost")[0]).toMatchObject({
      id: "keybinding-composer.cycleHost",
      targetId: "keybindings",
    });
    expect(searchSettings("thread.stop")[0]?.targetId).toBeUndefined();
    expect(searchSettings("sidebar.toggle")[0]?.targetId).toBeUndefined();
  });

  it("keeps catalog result ids unique", () => {
    const ids = SETTINGS_SEARCH_ITEMS.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("routes appearance settings to their current section", () => {
    expect(searchSettings("theme")[0]).toMatchObject({
      id: "theme",
      to: "/settings/appearance",
    });
    expect(searchSettings("word wrap")[0]).toMatchObject({
      id: "word-wrap",
      to: "/settings/appearance",
    });
    expect(searchSettings("usage limits")[0]).toMatchObject({
      id: "usage-limits",
      to: "/settings/appearance",
    });
  });
});

describe("settings search targets", () => {
  it("requires an environment for the resolved telemetry export destination", () => {
    const result = searchSettings("OpenTelemetry export").find(
      (item) => item.id === "telemetry-export",
    )!;
    const target = getSettingsSearchTargetScope(result.targetId ?? result.id)!;
    expect(isSettingsSearchScopeAvailable(target.scope, "all")).toBe(false);
    expect(isSettingsSearchScopeAvailable(target.scope, "project")).toBe(false);
    expect(isSettingsSearchScopeAvailable(target.scope, "environment")).toBe(true);
  });

  it("treats device-local rows as reachable from every selection", () => {
    const setting = getSettingsSearchTargetScope("time-format")!;
    expect(setting).toEqual({ title: "Time format", scope: null });
    expect(isSettingsSearchScopeAvailable(setting.scope, "project")).toBe(true);
    expect(isSettingsSearchScopeAvailable(setting.scope, "all")).toBe(true);
    expect(getSettingsSearchTargetScope("appearance")).toMatchObject({ scope: null });
    expect(getSettingsSearchTargetScope("missing-setting")).toBeNull();
  });

  it("keeps environment-wide settings out of project scopes", () => {
    const updates = getSettingsSearchTargetScope("provider-update-checks")!;
    expect(updates.scope).toBe("environment-defaults");
    expect(isSettingsSearchScopeAvailable(updates.scope, "environment")).toBe(true);
    expect(isSettingsSearchScopeAvailable(updates.scope, "all")).toBe(true);
    expect(isSettingsSearchScopeAvailable(updates.scope, "project")).toBe(false);
    const streaming = getSettingsSearchTargetScope("response-streaming")!;
    expect(streaming.scope).toBe("project-defaults");
    expect(isSettingsSearchScopeAvailable(streaming.scope, "project")).toBe(true);
  });
});

describe("auto-mark-done search availability", () => {
  function environment(id: string, { connected = true, loaded = true } = {}) {
    return {
      environmentId: EnvironmentId.make(id),
      connection: { phase: connected ? ("connected" as const) : ("offline" as const) },
      serverConfig: loaded ? { environment: { capabilities: {} } } : null,
    };
  }

  const capable = environment("capable");
  const offline = environment("offline", { connected: false });
  const loading = environment("loading", { loaded: false });
  const environments = [capable, offline, loading];

  it("keeps results discoverable when one connected environment supports them", () => {
    const availability = getThreadAutoMarkDoneSearchAvailability(environments);
    expect(availability.eligibleEnvironmentIds).toEqual([capable.environmentId]);
    const items = filterAvailableSettingsSearchItems({
      hasEnvironment: true,
      hasProviderSettingsEnvironment: true,
      hasMacProviderSettingsEnvironment: false,
      canManageLocalBackend: false,
      isWslSettingsRowVisible: false,
      hasThreadAutoMarkDone: availability.eligibleEnvironmentIds.length > 0,
    });
    expect(searchSettings("auto-mark-done", items).map((item) => item.id)).toEqual([
      "auto-mark-done-merged-threads",
      "auto-mark-done-inactive-threads",
      "auto-mark-done-keep-pull-requests",
      "days-before-auto-mark-done",
    ]);
  });

  it("offers connected environments when other targets are unavailable", () => {
    expect(
      getThreadAutoMarkDoneSearchAvailability(environments, {
        kind: "all",
        environmentIds: environments.map((entry) => entry.environmentId),
      }),
    ).toEqual({ eligibleEnvironmentIds: [capable.environmentId], isTargetAvailable: true });
  });

  it("allows a capable named environment regardless of other environments' capabilities", () => {
    expect(
      getThreadAutoMarkDoneSearchAvailability(environments, {
        kind: "environment",
        environmentIds: [capable.environmentId],
      }).isTargetAvailable,
    ).toBe(true);
  });

  it.each([offline, loading])(
    "does not render the target on $environmentId or silently fall back",
    (selected) => {
      expect(
        getThreadAutoMarkDoneSearchAvailability(environments, {
          kind: "environment",
          environmentIds: [selected.environmentId],
        }),
      ).toEqual({ eligibleEnvironmentIds: [capable.environmentId], isTargetAvailable: false });
    },
  );

  it("offers a capable environment instead of a dead target at an unavailable scope", () => {
    expect(
      getThreadAutoMarkDoneSearchAvailability(environments, {
        kind: "unavailable",
        environmentIds: [capable.environmentId],
      }),
    ).toEqual({ eligibleEnvironmentIds: [capable.environmentId], isTargetAvailable: false });
  });

  it("ignores offline and unloaded targets when all connected targets support the setting", () => {
    const selected = [capable, offline, loading];
    expect(
      getThreadAutoMarkDoneSearchAvailability(selected, {
        kind: "all",
        environmentIds: selected.map((entry) => entry.environmentId),
      }).isTargetAvailable,
    ).toBe(true);
  });

  it("offers no unavailable environments when none can render the setting", () => {
    const selected = [offline, loading];
    expect(
      getThreadAutoMarkDoneSearchAvailability(selected, {
        kind: "all",
        environmentIds: selected.map((entry) => entry.environmentId),
      }),
    ).toEqual({ eligibleEnvironmentIds: [], isTargetAvailable: false });
    expect(getThreadAutoMarkDoneSearchAvailability([]).eligibleEnvironmentIds).toEqual([]);
  });
});

describe("settings section availability", () => {
  it("hides Codex Micro without the desktop keyboard bridge", () => {
    expect(isSettingsSectionAvailable("/settings/codex-micro")).toBe(false);
    expect(isSettingsSectionAvailable("/settings/general")).toBe(true);
    expect(searchSettings("codex micro")).toEqual([]);

    vi.stubGlobal("window", { desktopBridge: {} });
    try {
      expect(isSettingsSectionAvailable("/settings/codex-micro")).toBe(false);
      expect(searchSettings("codex micro")).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("offers Codex Micro when the desktop keyboard bridge exists", () => {
    vi.stubGlobal("window", { desktopBridge: { codexMicro: {} } });
    try {
      expect(isSettingsSectionAvailable("/settings/codex-micro")).toBe(true);
      expect(searchSettings("codex micro").map((item) => item.id)).toContain("codex-micro-enabled");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
