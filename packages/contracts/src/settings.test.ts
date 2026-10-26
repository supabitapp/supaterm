import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { type CommandId, ProjectId } from "./baseSchemas.ts";
import { ProviderDriverKind, ProviderInstanceId } from "./providerInstance.ts";
import {
  BRANCH_NAMING_CHOICES,
  branchNamingChoiceOf,
  branchNamingChoicePatch,
  ClientSettingsSchema,
  ClientSettingsPatch,
  ClaudeSettings,
  DEFAULT_SERVER_SETTINGS,
  requiredScopesForProjectMutation,
  resolveProjectProviderInstanceEnabled,
  resolveProviderInstanceEnabled,
  ServerSettings,
  ServerSettingsPatch,
  shouldRecommendDatabaseCompaction,
} from "./settings.ts";

const decodeClientSettings = Schema.decodeUnknownSync(ClientSettingsSchema);
const decodeClientSettingsPatch = Schema.decodeUnknownSync(ClientSettingsPatch);
const encodeClientSettings = Schema.encodeSync(ClientSettingsSchema);
const decodeServerSettings = Schema.decodeUnknownSync(ServerSettings);
const decodeServerSettingsPatch = Schema.decodeUnknownSync(ServerSettingsPatch);
const encodeServerSettings = Schema.encodeSync(ServerSettings);
const decodeClaudeSettings = Schema.decodeUnknownSync(ClaudeSettings);

describe("automatic pull", () => {
  it("enables automatic pull when no preference is saved", () => {
    expect(decodeServerSettings({}).defaultAutoPull).toBe(true);
    expect(DEFAULT_SERVER_SETTINGS.defaultAutoPull).toBe(true);
  });

  it.each([true, false])("preserves an explicit %s preference and project override", (enabled) => {
    const input = {
      defaultAutoPull: enabled,
      projectSettingsOverrides: { project: { defaultAutoPull: enabled } },
    };
    expect(encodeServerSettings(decodeServerSettings(input))).toMatchObject(input);
    expect(decodeServerSettingsPatch(input)).toEqual(input);
  });
});

describe("restart continuation", () => {
  it("enables continuation for sparse existing settings", () => {
    expect(decodeServerSettings({}).continueThreadsAfterServerUpdate).toBe(true);
    expect(DEFAULT_SERVER_SETTINGS.continueThreadsAfterServerUpdate).toBe(true);
  });

  it.each([true, false])("preserves an explicit %s preference", (enabled) => {
    const input = { continueThreadsAfterServerUpdate: enabled };
    expect(encodeServerSettings(decodeServerSettings(input))).toMatchObject(input);
    expect(decodeServerSettingsPatch(input)).toEqual(input);
  });
});

describe("ServerSettings Encrypted Relay", () => {
  it("enables relay by default for settings without a saved preference", () => {
    expect(decodeServerSettings({})).toMatchObject({
      publicRelayEnabled: true,
      publicRelayUrl: "wss://relay.supaterm.com",
    });
  });

  it.each([true, false])("preserves the saved %s preference and accepts updates", (enabled) => {
    const input = { publicRelayEnabled: enabled };
    expect(encodeServerSettings(decodeServerSettings(input))).toMatchObject(input);
    expect(decodeServerSettingsPatch(input)).toEqual(input);
  });
});

describe("question automatic dismissal", () => {
  it("discards retired preferences from saved settings and updates", () => {
    for (const autoDismissQuestions of [true, false]) {
      const settings = decodeServerSettings({ autoDismissQuestions });
      expect(settings).not.toHaveProperty("autoDismissQuestions");
      expect(encodeServerSettings(settings)).not.toHaveProperty("autoDismissQuestions");
      expect(decodeServerSettingsPatch({ autoDismissQuestions })).toEqual({});
    }
  });
});

describe("database compaction recommendation", () => {
  it.each([
    ["an unconverted database with 2 GiB free", {}, true],
    ["a database that already shrinks itself", { incrementalVacuumEnabled: true }, false],
    ["less than 1 GiB free", { reclaimableBytes: 512 * 1024 ** 2 }, false],
  ] as const)("suggests supaterm doctor for %s", (_name, change, recommended) => {
    expect(
      shouldRecommendDatabaseCompaction({
        databaseBytes: 4 * 1024 ** 3,
        reclaimableBytes: 2 * 1024 ** 3,
        incrementalVacuumEnabled: false,
        compactCommand: "supaterm doctor --base-dir /home/jane/.supaterm",
        ...change,
      }),
    ).toBe(recommended);
  });
});

describe("storage cleanup settings", () => {
  it("enables safe worktree cleanup rules by default", () => {
    expect(decodeServerSettings({}).worktreeCleanup).toBeNull();
    expect(decodeServerSettings({}).storageCleanup).toEqual({
      worktreeAfterDays: null,
      worktreeDoneAfterDays: null,
      worktreeOnMerge: true,
      worktreeOnDelete: true,
      worktreeUnchanged: true,
      worktreeKeepWhen: "uncommitted-changes",
      browserArtifactsAfterDays: null,
      logsAfterDays: null,
    });
  });

  it("accepts partial custom patches but requires complete stored project rules", () => {
    expect(
      decodeServerSettingsPatch({
        worktreeCleanup: { mode: "custom", rules: { worktreeAfterDays: 8 } },
      }),
    ).toEqual({ worktreeCleanup: { mode: "custom", rules: { worktreeAfterDays: 8 } } });
    expect(() =>
      decodeServerSettings({
        projectSettingsOverrides: {
          project: { worktreeCleanup: { mode: "custom", rules: { worktreeAfterDays: 8 } } },
        },
      }),
    ).toThrow();
    expect(
      decodeServerSettings({
        projectSettingsOverrides: {
          project: {
            worktreeCleanup: {
              mode: "custom",
              rules: {
                worktreeAfterDays: null,
                worktreeOnMerge: false,
                worktreeOnDelete: false,
                worktreeUnchanged: false,
              },
            },
          },
        },
      }).projectSettingsOverrides[ProjectId.make("project")]?.worktreeCleanup,
    ).toMatchObject({
      mode: "custom",
      rules: { worktreeDoneAfterDays: null, worktreeKeepWhen: "uncommitted-changes" },
    });
  });

  it("decodes older custom rules with the default local-file policy", () => {
    const settings = decodeServerSettings({
      worktreeCleanup: {
        mode: "custom",
        rules: {
          worktreeAfterDays: 8,
          worktreeOnMerge: false,
          worktreeOnDelete: false,
          worktreeUnchanged: false,
        },
      },
    });
    expect(settings.worktreeCleanup).toMatchObject({
      rules: { worktreeKeepWhen: "uncommitted-changes" },
    });
    expect(
      decodeServerSettingsPatch({ storageCleanup: { worktreeKeepWhen: "tracked-changes" } }),
    ).toEqual({ storageCleanup: { worktreeKeepWhen: "tracked-changes" } });
    expect(() =>
      decodeServerSettingsPatch({ storageCleanup: { worktreeKeepWhen: "unknown" } }),
    ).toThrow();
  });
});

describe("ServerSettings usage price overrides", () => {
  const prices = { inputCostPerMillionTokens: 2, outputCostPerMillionTokens: 8 };

  it("rejects empty model IDs and incomplete input/output pricing", () => {
    for (const usagePriceOverrides of [
      { " ": prices },
      { "example-model": { inputCostPerMillionTokens: 2 } },
      { "example-model": { outputCostPerMillionTokens: 8 } },
    ]) {
      expect(() => decodeServerSettingsPatch({ usagePriceOverrides })).toThrow();
    }
  });
});

describe("custom model settings", () => {
  const capabilities = {
    optionDescriptors: [
      {
        id: "effort",
        label: "Reasoning",
        type: "select",
        options: [{ id: "high", label: "High", isDefault: true }],
      },
    ],
  };

  it("accepts legacy bare slugs alongside full entries", () => {
    const decoded = decodeClaudeSettings({
      customModels: ["bare-slug", { slug: "named", name: "Named", capabilities }],
    });
    expect(decoded.customModels).toEqual([
      "bare-slug",
      { slug: "named", name: "Named", capabilities },
    ]);
  });
});

describe("ClientSettings notifications", () => {
  it("requires opt-in when existing settings omit notification preferences", () => {
    expect(decodeClientSettings({}).notificationMode).toBe("off");
    expect(decodeClientSettings({}).inAppNotificationsEnabled).toBe(false);
    expect(decodeClientSettingsPatch({})).not.toHaveProperty("inAppNotificationsEnabled");
    expect(decodeClientSettingsPatch({})).not.toHaveProperty("notificationMode");
  });
});

describe("ClientSettings panel animations", () => {
  it.each([0, 200, 400])("ignores the retired duration preference: %s", (value) => {
    const stored = { panelAnimationDurationMs: value, chatWidth: "wide" };
    expect(decodeClientSettings(stored)).not.toHaveProperty("panelAnimationDurationMs");
    expect(decodeClientSettings(stored).chatWidth).toBe("wide");
    expect(decodeClientSettingsPatch(stored)).toEqual({ chatWidth: "wide" });
  });
});

describe("ClientSettings retired environment identification", () => {
  it("drops the old presentation preference", () => {
    const stored = { environmentIdentificationMode: "none" };
    expect(decodeClientSettings(stored)).not.toHaveProperty("environmentIdentificationMode");
    expect(decodeClientSettingsPatch(stored)).toEqual({});
  });
});

describe("ClientSettings sidebar", () => {
  it.each(["cards", "compact"])("ignores the retired %s display preference", (mode) => {
    const stored = { sidebarThreadDisplay: mode };
    expect(decodeClientSettings(stored)).not.toHaveProperty("sidebarThreadDisplay");
    expect(decodeClientSettingsPatch(stored)).toEqual({});
  });
});

describe("ClientSettings removed feature settings", () => {
  it("drops removed feature settings from stored values and patches", () => {
    const stored = {
      planModeEnabled: true,
      contextWindowMeterEnabled: true,
      legacySidebarEnabled: true,
    };
    const decoded = decodeClientSettings(stored);
    expect(decoded).not.toHaveProperty("planModeEnabled");
    expect(decoded).not.toHaveProperty("contextWindowMeterEnabled");
    expect(decoded).not.toHaveProperty("legacySidebarEnabled");
    expect(decodeClientSettingsPatch(stored)).toEqual({});
  });
});

describe("ClientSettings follow-up behavior", () => {
  it("defaults to steer and accepts either behavior", () => {
    expect(decodeClientSettings({}).followUpBehavior).toBe("steer");
    for (const followUpBehavior of ["queue", "steer"]) {
      expect(decodeClientSettings({ followUpBehavior }).followUpBehavior).toBe(followUpBehavior);
      expect(decodeClientSettingsPatch({ followUpBehavior }).followUpBehavior).toBe(
        followUpBehavior,
      );
    }
    expect(() => decodeClientSettingsPatch({ followUpBehavior: "invalid" })).toThrow();
  });
});

describe("ServerSettings thread completion", () => {
  it("defaults merge completion off and inactivity completion to three days", () => {
    const settings = decodeServerSettings({});
    expect(settings.sidebarAutoMarkDoneAfterDays).toBe(3);
    expect(settings.sidebarAutoMarkDoneOnMerge).toBe(false);
  });

  it.each([-1, 0, 91])("rejects an auto-mark done threshold outside 1..90: %s", (value) => {
    expect(() => decodeServerSettings({ sidebarAutoMarkDoneAfterDays: value })).toThrow();
    expect(() => decodeServerSettingsPatch({ sidebarAutoMarkDoneAfterDays: value })).toThrow();
  });
});

describe("provider enabled defaults", () => {
  it("resolves instance enabled state with explicit false winning", () => {
    const grok = ProviderDriverKind.make("grok");
    const codex = ProviderDriverKind.make("codex");
    expect(resolveProviderInstanceEnabled({ driver: grok, config: {} })).toBe(false);
    expect(resolveProviderInstanceEnabled({ driver: codex, config: {} })).toBe(true);
    expect(
      resolveProviderInstanceEnabled({ driver: ProviderDriverKind.make("ollama"), config: {} }),
    ).toBe(true);
    expect(resolveProviderInstanceEnabled({ driver: grok, enabled: true, config: {} })).toBe(true);
    expect(resolveProviderInstanceEnabled({ driver: codex, enabled: false, config: {} })).toBe(
      false,
    );
    expect(resolveProviderInstanceEnabled({ driver: grok, config: { enabled: true } })).toBe(true);
    expect(
      resolveProviderInstanceEnabled({ driver: grok, enabled: true, config: { enabled: false } }),
    ).toBe(false);
    expect(
      resolveProviderInstanceEnabled({ driver: codex, enabled: false, config: { enabled: true } }),
    ).toBe(false);
  });
});

describe("ServerSettings worktree defaults", () => {
  it("defaults the thread env mode to inherit and keeps stored values", () => {
    expect(decodeServerSettings({}).defaultThreadEnvMode).toBeNull();
    expect(decodeServerSettings({ defaultThreadEnvMode: "worktree" }).defaultThreadEnvMode).toBe(
      "worktree",
    );
    expect(
      decodeServerSettings({ defaultThreadEnvMode: "remote" }).defaultThreadEnvMode,
    ).toBeNull();
    expect(
      decodeServerSettingsPatch({ defaultThreadEnvMode: null }).defaultThreadEnvMode,
    ).toBeNull();
  });

  it("keeps an inherited thread env mode off the wire for older clients", () => {
    const encode = Schema.encodeSync(ServerSettings);
    expect("defaultThreadEnvMode" in encode(decodeServerSettings({}))).toBe(false);
    expect(
      encode(decodeServerSettings({ defaultThreadEnvMode: "worktree" })).defaultThreadEnvMode,
    ).toBe("worktree");
  });
});

describe("ServerSettings.sourceControlWritingStyle", () => {
  it.each([
    { legacy: "", mode: "repo_conventions", customInstructions: "" },
    { legacy: " \t\n ", mode: "repo_conventions", customInstructions: "" },
    {
      legacy: "  Prefer concise wording.\nKeep issue references.  ",
      mode: "custom",
      customInstructions: "Prefer concise wording.\nKeep issue references.",
    },
  ])("normalizes legacy writing style $legacy in snapshots only", ({ legacy, ...expected }) => {
    const style = { ...expected, followChangeRequestTemplates: true };
    for (const [input, normalized] of [
      [{ sourceControlWritingStyle: legacy }, { sourceControlWritingStyle: style }],
      [
        { projectSettingsOverrides: { project: { sourceControlWritingStyle: legacy } } },
        { projectSettingsOverrides: { project: { sourceControlWritingStyle: style } } },
      ],
    ] as const) {
      const settings = decodeServerSettings(input);
      expect(settings).toMatchObject(normalized);
      expect(encodeServerSettings(settings)).toMatchObject(normalized);
      expect(() => decodeServerSettingsPatch(input)).toThrow();
    }
  });
});

describe("ServerSettings environment icon", () => {
  it("decodes a kind from a newer server as null instead of failing the snapshot", () => {
    expect(decodeServerSettings({ environmentIcon: "toaster" }).environmentIcon).toBeNull();
  });
});

const decodeDeviceHostSettings = Schema.decodeSync(ServerSettings);

// `deviceHosts` as it was decoded before EAS hosts existed: an SSH host needs a target.
const decodeOlderDeviceHostSettings = Schema.decodeUnknownSync(
  Schema.Struct({
    deviceHosts: Schema.Array(Schema.Struct({ id: Schema.String, target: Schema.String })),
  }),
);

it("keeps EAS hosts out of the SSH host list servers and clients before EAS hosts decode", () => {
  const settings = decodeDeviceHostSettings({
    deviceHosts: [{ id: "mini", label: "Mac mini", target: "user@mini" }],
    easDeviceHosts: [{ kind: "eas", id: "eas", label: "EAS Simulator" }],
  });
  const wire = encodeServerSettings(settings);
  expect(decodeOlderDeviceHostSettings(wire).deviceHosts).toEqual([
    { id: "mini", target: "user@mini" },
  ]);
  expect(settings.easDeviceHosts.map((host) => host.id)).toEqual(["eas"]);
});

it("validates remote device hosts and rejects ambiguous host ids", () => {
  const host = { id: "mini", label: "Mac mini", target: "user@mini", port: 2222 };
  // Hosts saved before EAS hosts existed have no `kind`; they are SSH hosts.
  expect(decodeDeviceHostSettings({ deviceHosts: [host] }).deviceHosts).toEqual([
    { kind: "ssh", ...host },
  ]);
  expect(() => decodeDeviceHostSettings({ deviceHosts: [host, host] })).toThrow();
  expect(() => decodeDeviceHostSettings({ deviceHosts: [{ ...host, id: "local" }] })).toThrow();
  expect(() =>
    decodeDeviceHostSettings({ deviceHosts: [{ ...host, target: "-oProxyCommand=bad" }] }),
  ).toThrow();
  expect(() => decodeDeviceHostSettings({ deviceHosts: [{ ...host, port: 0 }] })).toThrow();
});

describe("branch naming settings", () => {
  it("defaults existing settings to the Supaterm static prefix", () => {
    expect(decodeServerSettings({})).toMatchObject({
      branchNamingMode: "static",
      branchNamePrefix: "supaterm",
      branchNamePrefixFromRepository: false,
      branchNameInstructions: "",
    });
  });
  it.each(BRANCH_NAMING_CHOICES)(
    "stores the %s choice as a mode older clients decode",
    (choice) => {
      const settings = decodeServerSettings(branchNamingChoicePatch(choice));
      expect(["static", "semantic", "custom"]).toContain(settings.branchNamingMode);
      expect(
        branchNamingChoiceOf(settings.branchNamingMode, settings.branchNamePrefixFromRepository),
      ).toBe(choice);
    },
  );
  it.each(["static", "semantic", "custom"])(
    "round-trips %s and project overrides",
    (branchNamingMode) => {
      const naming = {
        branchNamingMode,
        branchNamePrefix: "team/",
        branchNamePrefixFromRepository: true,
        branchNameInstructions: "Include the issue ID.",
      };
      const input = { ...naming, projectSettingsOverrides: { project: naming } };
      expect(encodeServerSettings(decodeServerSettings(input))).toMatchObject(input);
      expect(decodeServerSettingsPatch(input)).toEqual(input);
    },
  );
});

describe("resolveProjectProviderInstanceEnabled", () => {
  const projectId = "project-a" as ProjectId;
  const instanceId = ProviderInstanceId.make("codex_work");

  it("lets a project disable an instance the machine enabled", () => {
    const settings: ServerSettings = {
      ...DEFAULT_SERVER_SETTINGS,
      providerInstances: {
        [instanceId]: { driver: ProviderDriverKind.make("codex"), enabled: true },
      },
      projectSettingsOverrides: {
        [projectId]: { providerInstances: { [instanceId]: { enabled: false } } },
      },
    };
    expect(resolveProjectProviderInstanceEnabled(settings, projectId, instanceId)).toBe(false);
  });
});

describe("requiredScopesForProjectMutation", () => {
  it("adds the settings scope only when a mutation carries scripts", () => {
    const projectId = "project-1" as ProjectId;
    const commandId = "command-1" as CommandId;
    expect(
      requiredScopesForProjectMutation({ type: "project.update", commandId, projectId }),
    ).toEqual(["orchestration:operate"]);
    expect(
      requiredScopesForProjectMutation({
        type: "project.update",
        commandId,
        projectId,
        scripts: [],
      }),
    ).toEqual(["orchestration:operate", "settings:write"]);
  });
});

describe("server model preferences", () => {
  it("defaults to empty lists", () => {
    expect(decodeServerSettings({})).toMatchObject({
      favorites: [],
      providerModelPreferences: {},
    });
  });
});

describe("thread grouping preference", () => {
  it("defaults existing client settings to status", () => {
    expect(decodeClientSettings({}).sidebarThreadGrouping).toBe("status");
  });
  it.each(["status", "project"])("round trips %s", (sidebarThreadGrouping) => {
    const input = { sidebarThreadGrouping };
    expect(encodeClientSettings(decodeClientSettings(input))).toMatchObject(input);
    expect(decodeClientSettingsPatch(input)).toEqual(input);
  });
  it("rejects unknown grouping modes in patches", () => {
    expect(() => decodeClientSettingsPatch({ sidebarThreadGrouping: "unknown" })).toThrow();
  });
  it("loads saved settings with an unknown grouping as Default and keeps the rest", () => {
    const decoded = decodeClientSettings({
      sidebarThreadGrouping: "updated",
      confirmThreadDelete: false,
    });
    expect(decoded.sidebarThreadGrouping).toBe("status");
    expect(decoded.confirmThreadDelete).toBe(false);
  });
});
