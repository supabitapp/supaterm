import { describe, expect, it, vi } from "vite-plus/test";
import {
  EnvironmentId,
  makeProviderSettingsSchema,
  SourceControlProviderKind,
} from "@supaterm/contracts";
import { UNKNOWN_SOURCE_CONTROL_CLIENT } from "@supaterm/client-runtime/source-control-clients";
import * as Schema from "effect/Schema";

import {
  filterAvailableSettingsSearchItems,
  getSettingsSearchTargetScope,
  getThreadAutoMarkDoneSearchAvailability,
  isSettingsSearchScopeAvailable,
  isSettingsSectionAvailable,
  movedSettingsPath,
  searchSettings,
  SETTINGS_SEARCH_ITEMS,
  sourceControlHostSearchItems,
  sourceControlHostSettingsSearchId,
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
    to: "/settings/access",
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
    expect(searchSettings("sharing", ITEMS).map((item) => item.id)).toEqual(["network-access"]);
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

  it("finds keybinding commands by label, command id, and default key", () => {
    expect(searchSettings("toggle sidebar")[0]?.id).toBe("keybinding-sidebar.toggle");
    expect(searchSettings("sidebar.toggle")[0]?.id).toBe("keybinding-sidebar.toggle");
    expect(searchSettings("mod+b")[0]?.id).toBe("keybinding-sidebar.toggle");
    expect(searchSettings("copy link")[0]).toMatchObject({
      id: "keybinding-thread.copyReference",
      to: "/settings/keybindings",
    });
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

  it("ignores offline and unloaded targets when all connected targets support the setting", () => {
    const selected = [capable, offline, loading];
    expect(
      getThreadAutoMarkDoneSearchAvailability(selected, {
        kind: "all",
        environmentIds: selected.map((entry) => entry.environmentId),
      }).isTargetAvailable,
    ).toBe(true);
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

describe("source control host search items", () => {
  const definition = {
    ...UNKNOWN_SOURCE_CONTROL_CLIENT,
    kind: SourceControlProviderKind.make("example"),
    label: "Example",
    searchKeywords: ["sample"],
    settings: makeProviderSettingsSchema({ apiToken: Schema.String }),
  };

  it("lists a host by its label, its keywords, and its settings fields", () => {
    const items = sourceControlHostSearchItems([UNKNOWN_SOURCE_CONTROL_CLIENT, definition]);
    expect(items.map((item) => item.title)).toEqual(["Example credentials"]);
    expect(searchSettings("sample apitoken", items).map((item) => item.id)).toEqual([
      sourceControlHostSettingsSearchId("example"),
    ]);
  });

  it("lists a host with credentials by its accounts, token and CLI", () => {
    const items = sourceControlHostSearchItems([
      {
        ...definition,
        credentials: {
          cliName: "ex",
          cliLabel: "Example CLI",
          loginCommand: "ex login",
          tokenEnvVar: "EX_TOKEN",
          tokenAccess: "access",
          newTokenUrl: (host) => `https://${host}/tokens`,
        },
      },
    ]);
    expect(items.map((item) => item.title)).toEqual(["Example accounts and token"]);
    expect(searchSettings("ex switch accounts", items)).toHaveLength(1);
  });

  it("finds the built-in hosts by their own words", () => {
    expect(searchSettings("codeberg").map((item) => item.id)).toContain("source-control");
    expect(searchSettings("ghes").map((item) => item.id)).toContain(
      sourceControlHostSettingsSearchId("github"),
    );
  });
});

describe("movedSettingsPath", () => {
  it("sends old links to the page their row moved to", () => {
    expect(movedSettingsPath("/settings/general", "text-generation-model")).toBe(
      "/settings/threads",
    );
    expect(movedSettingsPath("/settings/general", "app-version")).toBe("/settings/about");
    expect(movedSettingsPath("/settings/general", "next-prompt-suggestions")).toBe(
      "/settings/threads",
    );
    expect(movedSettingsPath("/settings/connections", "authorized-clients")).toBe(
      "/settings/access",
    );
    expect(movedSettingsPath("/settings/connections", "public-relay")).toBe("/settings/access");
    expect(movedSettingsPath("/settings/source-control", "worktree-branch-naming")).toBe(
      "/settings/worktrees",
    );
    expect(movedSettingsPath("/settings/appearance", "diff-color-scheme")).toBe("/settings/diffs");
    expect(movedSettingsPath("/settings/storage", "storage-worktrees")).toBe("/settings/worktrees");
    expect(movedSettingsPath("/settings/storage", "")).toBe("/settings/maintenance");
    expect(movedSettingsPath("/settings/integrations", "devices")).toBe("/settings/devices");
    expect(movedSettingsPath("/settings/integrations", "orchestration-skills")).toBe(
      "/settings/threads",
    );
    expect(movedSettingsPath("/settings/integrations", "")).toBe("/settings/browser");
  });

  it("leaves current pages alone", () => {
    expect(movedSettingsPath("/settings/general", "time-format")).toBeNull();
    expect(movedSettingsPath("/settings/general", "")).toBeNull();
    expect(movedSettingsPath("/settings/projects", "project-defaults")).toBeNull();
    expect(movedSettingsPath("/settings/connections", "remote-environments")).toBeNull();
    expect(movedSettingsPath("/settings/appearance", "theme")).toBeNull();
    expect(movedSettingsPath("/settings/codex-micro", "")).toBeNull();
  });
});
