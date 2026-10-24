import {
  DEFAULT_SERVER_SETTINGS,
  ProjectId,
  ProviderDriverKind,
  ProjectSettingsOverrides,
  ProviderInstanceId,
  ServerSettingsPatch,
  WorktreeCleanupRules,
  type ServerProvider,
} from "@supaterm/contracts";
import * as Duration from "effect/Duration";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";
import { resolveServerBackgroundActivitySettings } from "./backgroundActivitySettings.ts";
import { createModelSelection } from "./model.ts";
import { resolveProjectScripts, projectScriptsInheritDefaults } from "./projectScripts.ts";
import {
  applyServerSettingsPatch,
  fallbackTextGenerationModelSelection,
  isModelSelectionProviderEnabled,
  parsePersistedServerObservabilitySettings,
  resolveSourceControlWriterModelSelection,
  resolveReviewGuideModelSelection,
} from "./serverSettings.ts";

const decodeServerSettingsPatch = Schema.decodeUnknownSync(ServerSettingsPatch);

const FOLDED_SERVER_SETTINGS = { ...DEFAULT_SERVER_SETTINGS, projectSettingsFolded: true };

describe("resolveReviewGuideModelSelection", () => {
  const snapshot = (instanceId: string, supportsReviewGuides: boolean): ServerProvider => ({
    instanceId: ProviderInstanceId.make(instanceId),
    driver: ProviderDriverKind.make("codex"),
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-07-27T00:00:00.000Z",
    supportsReviewGuides,
    models: [
      {
        slug: "review-model",
        name: "Review model",
        isDefault: true,
        isCustom: false,
        capabilities: { optionDescriptors: [] },
      },
    ],
    slashCommands: [],
    skills: [],
  });
  it("skips incapable defaults and selects a compatible project-enabled provider", () => {
    const incapable = snapshot("writer", false);
    const capable = snapshot("reader", true);
    const projectId = ProjectId.make("project");
    const settings = {
      ...DEFAULT_SERVER_SETTINGS,
      textGenerationModelSelection: createModelSelection(incapable.instanceId, "writer-model"),
      providerInstances: {
        [incapable.instanceId]: { driver: incapable.driver, enabled: true, config: {} },
        [capable.instanceId]: { driver: capable.driver, enabled: true, config: {} },
      },
    };
    expect(resolveReviewGuideModelSelection(settings, [incapable, capable], projectId)).toEqual(
      createModelSelection(capable.instanceId, "review-model"),
    );
    const disabled = {
      ...settings,
      projectSettingsOverrides: {
        [projectId]: { providerInstances: { [capable.instanceId]: { enabled: false } } },
      },
    };
    expect(
      resolveReviewGuideModelSelection(disabled, [incapable, capable], projectId).instanceId,
    ).not.toBe(capable.instanceId);
    const saved = {
      ...settings,
      reviewGuideModelSelection: createModelSelection(capable.instanceId, "custom-model"),
    };
    expect(resolveReviewGuideModelSelection(saved, [incapable, capable], projectId)).toBe(
      saved.reviewGuideModelSelection,
    );
  });
});

describe("fallbackTextGenerationModelSelection", () => {
  it("ignores a configured non-default instance at machine scope, matching no fallback", () => {
    const configured = ProviderInstanceId.make("codex_work");
    const providerInstances = {
      [configured]: { driver: ProviderDriverKind.make("codex"), config: {} },
    };
    const fallback = fallbackTextGenerationModelSelection(
      providerInstances,
      (instanceId) => instanceId === configured,
    );
    expect(fallback).toBeNull();
  });

  it("considers a configured non-default instance only when asked to", () => {
    const configured = ProviderInstanceId.make("codex_work");
    const providerInstances = {
      [configured]: { driver: ProviderDriverKind.make("codex"), config: {} },
    };
    const fallback = fallbackTextGenerationModelSelection(
      providerInstances,
      (instanceId) => instanceId === configured,
      { includeConfiguredInstances: true },
    );
    expect(fallback?.instanceId).toBe(configured);
  });
});

describe("serverSettings helpers", () => {
  it("changes a cleanup rule without replacing the machine's other rules", () => {
    const enabled = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
      storageCleanup: { worktreeAfterDays: 8, worktreeOnMerge: true, logsAfterDays: 30 },
    });
    expect(
      applyServerSettingsPatch(enabled, {
        storageCleanup: { worktreeAfterDays: null },
      }).storageCleanup,
    ).toEqual({
      worktreeAfterDays: null,
      worktreeDoneAfterDays: null,
      worktreeOnMerge: true,
      worktreeOnDelete: true,
      worktreeUnchanged: true,
      worktreeKeepWhen: "uncommitted-changes",
      browserArtifactsAfterDays: null,
      logsAfterDays: 30,
    });
  });
  it("replaces a source control host's patched field so a cleared account pin does not survive", () => {
    const pinned = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
      sourceControlHosts: {
        github: { hosts: { "github.com": { account: "work", enabled: true } }, tokens: {} },
      },
    });
    const unpinned = applyServerSettingsPatch(pinned, {
      sourceControlHosts: { github: { hosts: { "github.com": { enabled: false } } } },
    });
    expect(unpinned.sourceControlHosts.github).toEqual({
      hosts: { "github.com": { enabled: false } },
      tokens: {},
    });
  });
  it("replaces SSH host lists when saving, editing, and removing hosts", () => {
    const host = { kind: "ssh" as const, id: "mini", label: "Mac mini", target: "mini" };
    const saved = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, { deviceHosts: [host] });
    expect(saved.deviceHosts).toEqual([host]);
    const replacement = { ...host, target: "other-mini" };
    const edited = applyServerSettingsPatch(saved, { deviceHosts: [replacement] });
    expect(edited.deviceHosts).toEqual([replacement]);
    expect(applyServerSettingsPatch(edited, { deviceHosts: [] }).deviceHosts).toEqual([]);
  });

  it("replaces the push gateway allowlist instead of merging entries", () => {
    expect(DEFAULT_SERVER_SETTINGS.pushGatewayOrigins).toEqual(["https://push.supaterm.com"]);
    const added = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
      pushGatewayOrigins: ["http://localhost:8000", "https://push.example.com"],
    });
    expect(
      applyServerSettingsPatch(added, { pushGatewayOrigins: ["https://push.example.com"] })
        .pushGatewayOrigins,
    ).toEqual(["https://push.example.com"]);
  });

  it("replaces EAS host lists the same way", () => {
    const host = {
      kind: "eas" as const,
      id: "eas",
      label: "EAS Simulator",
      accessToken: "",
      maxSessionMinutes: 30,
      idleMinutes: 10,
      maxConcurrentSessions: 2,
    };
    const saved = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, { easDeviceHosts: [host] });
    expect(saved.easDeviceHosts).toEqual([host]);
    const edited = applyServerSettingsPatch(saved, {
      easDeviceHosts: [{ ...host, maxSessionMinutes: 60 }],
    });
    expect(edited.easDeviceHosts).toEqual([{ ...host, maxSessionMinutes: 60 }]);
    expect(applyServerSettingsPatch(edited, { easDeviceHosts: [] }).easDeviceHosts).toEqual([]);
  });

  it("inherits actions, preserves existing actions, and supports empty overrides and reset", () => {
    const project = { id: ProjectId.make("project-actions"), scripts: [] };
    const action = {
      id: "check",
      name: "Check",
      command: "npm test",
      icon: "play" as const,
      runOnWorktreeCreate: false,
    };
    const existing = { ...project, scripts: [{ ...action, command: "npm run lint" }] };
    const unfolded = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
      defaultProjectScripts: [action],
    });
    expect(resolveProjectScripts(unfolded, existing)).toEqual(existing.scripts);
    expect(projectScriptsInheritDefaults(unfolded, existing)).toBe(false);
    const defaults = applyServerSettingsPatch(FOLDED_SERVER_SETTINGS, {
      defaultProjectScripts: [action],
    });
    expect(resolveProjectScripts(defaults, project)).toEqual([action]);
    expect(projectScriptsInheritDefaults(defaults, project)).toBe(true);
    expect(resolveProjectScripts(defaults, existing)).toEqual([action]);
    const disabled = applyServerSettingsPatch(defaults, {
      projectSettingsOverrides: { [project.id]: { defaultProjectScripts: [] } },
    });
    expect(resolveProjectScripts(disabled, project)).toEqual([]);
    expect(projectScriptsInheritDefaults(disabled, project)).toBe(false);
    const changedDefault = applyServerSettingsPatch(disabled, {
      defaultProjectScripts: [{ ...action, command: "npm run build" }],
    });
    expect(resolveProjectScripts(changedDefault, project)).toEqual([]);
    const reset = applyServerSettingsPatch(changedDefault, {
      projectSettingsOverrides: { [project.id]: null },
    });
    expect(resolveProjectScripts(reset, existing)).toEqual(changedDefault.defaultProjectScripts);
    expect(projectScriptsInheritDefaults(reset, existing)).toBe(true);
    expect(
      resolveProjectScripts(
        applyServerSettingsPatch(reset, { defaultProjectScripts: [] }),
        existing,
      ),
    ).toEqual([]);
  });

  it("preserves other projects' actions when overriding, clearing, or resetting one project", () => {
    const firstProject = { id: ProjectId.make("first-project"), scripts: [] };
    const secondProject = { id: ProjectId.make("second-project"), scripts: [] };
    const defaultAction = {
      id: "check",
      name: "Check",
      command: "npm test",
      icon: "play" as const,
      runOnWorktreeCreate: false,
    };
    const firstAction = { ...defaultAction, command: "npm run lint" };
    const secondAction = { ...defaultAction, command: "npm run build" };
    const firstUpdate = applyServerSettingsPatch(FOLDED_SERVER_SETTINGS, {
      defaultProjectScripts: [defaultAction],
      projectSettingsOverrides: { [firstProject.id]: { defaultProjectScripts: [firstAction] } },
    });
    const secondUpdate = applyServerSettingsPatch(firstUpdate, {
      projectSettingsOverrides: { [secondProject.id]: { defaultProjectScripts: [secondAction] } },
    });
    expect(resolveProjectScripts(secondUpdate, firstProject)).toEqual([firstAction]);
    expect(resolveProjectScripts(secondUpdate, secondProject)).toEqual([secondAction]);

    const cleared = applyServerSettingsPatch(secondUpdate, {
      projectSettingsOverrides: { [firstProject.id]: { defaultProjectScripts: [] } },
    });
    expect(resolveProjectScripts(cleared, firstProject)).toEqual([]);
    expect(resolveProjectScripts(cleared, secondProject)).toEqual([secondAction]);

    const reset = applyServerSettingsPatch(cleared, {
      projectSettingsOverrides: { [firstProject.id]: null },
    });
    expect(resolveProjectScripts(reset, { ...firstProject, scripts: [firstAction] })).toEqual([
      defaultAction,
    ]);
    expect(resolveProjectScripts(reset, secondProject)).toEqual([secondAction]);
    expect(resolveProjectScripts(secondUpdate, firstProject)).toEqual([firstAction]);
  });

  it("replaces and clears conversation model defaults without retaining old options", () => {
    const current = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
      defaultModelSelection: createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.4", [
        { id: "reasoningEffort", value: "high" },
      ]),
    });
    const selection = createModelSelection(ProviderInstanceId.make("claudeAgent"), "sonnet");
    const updated = applyServerSettingsPatch(current, { defaultModelSelection: selection });
    expect(updated.defaultModelSelection).toEqual(selection);
    expect(
      applyServerSettingsPatch(updated, { defaultModelSelection: null }).defaultModelSelection,
    ).toBeNull();
  });

  it("ignores missing and blank persisted observability URLs", () => {
    expect(parsePersistedServerObservabilitySettings("{}")).toEqual({
      otlpTracesUrl: undefined,
      otlpMetricsUrl: undefined,
      otlpLogsUrl: undefined,
    });
    expect(
      parsePersistedServerObservabilitySettings(
        JSON.stringify({
          observability: { otlpTracesUrl: "   ", otlpMetricsUrl: "", otlpLogsUrl: "   " },
        }),
      ),
    ).toEqual({
      otlpTracesUrl: undefined,
      otlpMetricsUrl: undefined,
      otlpLogsUrl: undefined,
    });
  });

  it("parses lenient persisted settings JSON and trims observability URLs", () => {
    expect(
      parsePersistedServerObservabilitySettings(
        JSON.stringify({
          observability: {
            otlpTracesUrl: "  http://localhost:4318/v1/traces  ",
            otlpMetricsUrl: "  http://localhost:4318/v1/metrics  ",
            otlpLogsUrl: "  http://localhost:4318/v1/logs  ",
          },
        }),
      ),
    ).toEqual({
      otlpTracesUrl: "http://localhost:4318/v1/traces",
      otlpMetricsUrl: "http://localhost:4318/v1/metrics",
      otlpLogsUrl: "http://localhost:4318/v1/logs",
    });
  });

  it("falls back cleanly when persisted settings are invalid", () => {
    expect(parsePersistedServerObservabilitySettings("{")).toEqual({
      otlpTracesUrl: undefined,
      otlpMetricsUrl: undefined,
      otlpLogsUrl: undefined,
    });
  });

  it("replaces text generation selection when provider/model are provided", () => {
    const current = {
      ...DEFAULT_SERVER_SETTINGS,
      textGenerationModelSelection: createModelSelection(
        ProviderInstanceId.make("codex"),
        "gpt-5.4-mini",
        [
          { id: "reasoningEffort", value: "high" },
          { id: "fastMode", value: true },
        ],
      ),
    };

    expect(
      applyServerSettingsPatch(current, {
        textGenerationModelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5.4-mini",
        },
      }).textGenerationModelSelection,
    ).toEqual({
      instanceId: "codex",
      model: "gpt-5.4-mini",
    });
  });

  it("still deep merges text generation selection when only options are provided", () => {
    const current = {
      ...DEFAULT_SERVER_SETTINGS,
      textGenerationModelSelection: createModelSelection(
        ProviderInstanceId.make("codex"),
        "gpt-5.4-mini",
        [
          { id: "reasoningEffort", value: "high" },
          { id: "fastMode", value: true },
        ],
      ),
    };

    expect(
      applyServerSettingsPatch(current, {
        textGenerationModelSelection: {
          options: [{ id: "fastMode", value: false }],
        },
      }).textGenerationModelSelection,
    ).toEqual({
      instanceId: "codex",
      model: "gpt-5.4-mini",
      options: [
        { id: "reasoningEffort", value: "high" },
        { id: "fastMode", value: false },
      ],
    });
  });

  it("replaces text generation selection across providers without leaking stale options", () => {
    const current = {
      ...DEFAULT_SERVER_SETTINGS,
      textGenerationModelSelection: createModelSelection(
        ProviderInstanceId.make("codex"),
        "gpt-5.4-mini",
        [
          { id: "reasoningEffort", value: "high" },
          { id: "fastMode", value: true },
        ],
      ),
    };

    expect(
      applyServerSettingsPatch(current, {
        textGenerationModelSelection: {
          instanceId: ProviderInstanceId.make("opencode"),
          model: "openai/gpt-5",
        },
      }).textGenerationModelSelection,
    ).toEqual({
      instanceId: "opencode",
      model: "openai/gpt-5",
    });
  });

  it("accepts array-based text generation selection patches", () => {
    expect(
      applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
        textGenerationModelSelection: {
          instanceId: ProviderInstanceId.make("opencode"),
          model: "openai/gpt-5",
          options: [
            { id: "variant", value: "prod" },
            { id: "agent", value: "build" },
          ],
        },
      }).textGenerationModelSelection,
    ).toEqual({
      instanceId: "opencode",
      model: "openai/gpt-5",
      options: [
        { id: "variant", value: "prod" },
        { id: "agent", value: "build" },
      ],
    });
  });

  it("replaces source control writer selection without retaining stale options", () => {
    const current = {
      ...DEFAULT_SERVER_SETTINGS,
      sourceControlWriterModelSelection: createModelSelection(
        ProviderInstanceId.make("codex"),
        "gpt-5.4-mini",
        [{ id: "reasoningEffort", value: "high" }],
      ),
    };

    expect(
      applyServerSettingsPatch(current, {
        sourceControlWriterModelSelection: {
          instanceId: ProviderInstanceId.make("opencode"),
          model: "openai/gpt-5",
        },
      }).sourceControlWriterModelSelection,
    ).toEqual({
      instanceId: "opencode",
      model: "openai/gpt-5",
    });
  });

  it("clears source control writer selection with null", () => {
    const current = {
      ...DEFAULT_SERVER_SETTINGS,
      sourceControlWriterModelSelection: createModelSelection(
        ProviderInstanceId.make("codex"),
        "gpt-5.4-mini",
      ),
    };

    expect(
      applyServerSettingsPatch(current, {
        sourceControlWriterModelSelection: null,
      }).sourceControlWriterModelSelection,
    ).toBeNull();
  });

  it("falls back from a disabled source control writer provider without clearing its selection", () => {
    const instanceId = ProviderInstanceId.make("codex_writer");
    const sourceControlWriterModelSelection = createModelSelection(instanceId, "gpt-5.4-mini");
    const settings = {
      ...DEFAULT_SERVER_SETTINGS,
      providerInstances: {
        [instanceId]: {
          driver: ProviderDriverKind.make("codex"),
          enabled: false,
          config: {},
        },
      },
      sourceControlWriterModelSelection,
    };

    expect(isModelSelectionProviderEnabled(settings, sourceControlWriterModelSelection)).toBe(
      false,
    );
    expect(resolveSourceControlWriterModelSelection(settings, undefined, null)).toBe(
      settings.textGenerationModelSelection,
    );
    expect(settings.sourceControlWriterModelSelection).toBe(sourceControlWriterModelSelection);
  });

  it("falls back from an unavailable source control writer provider", () => {
    const instanceId = ProviderInstanceId.make("missing_writer");
    const sourceControlWriterModelSelection = createModelSelection(instanceId, "missing-model");
    const settings = {
      ...DEFAULT_SERVER_SETTINGS,
      providerInstances: {
        [instanceId]: {
          driver: ProviderDriverKind.make("missing-driver"),
          config: {},
        },
      },
      sourceControlWriterModelSelection,
    };
    const unavailableProvider = {
      instanceId,
      driver: ProviderDriverKind.make("missing-driver"),
      enabled: false,
      installed: false,
      version: null,
      status: "disabled",
      auth: { status: "unknown" },
      checkedAt: "2026-07-27T00:00:00.000Z",
      availability: "unavailable",
      unavailableReason: "This provider driver is not available in this build.",
      models: [],
      slashCommands: [],
      skills: [],
    } satisfies ServerProvider;

    expect(resolveSourceControlWriterModelSelection(settings, [unavailableProvider], null)).toBe(
      settings.textGenerationModelSelection,
    );
    expect(settings.sourceControlWriterModelSelection).toBe(sourceControlWriterModelSelection);
  });

  it("falls back from a writer provider that cannot generate application text", () => {
    const instanceId = ProviderInstanceId.make("acp_writer");
    const sourceControlWriterModelSelection = createModelSelection(instanceId, "default");
    const settings = {
      ...DEFAULT_SERVER_SETTINGS,
      providerInstances: {
        [instanceId]: {
          driver: ProviderDriverKind.make("acpRegistry"),
          enabled: true,
          config: {},
        },
      },
      sourceControlWriterModelSelection,
    };
    const incapableProvider = {
      instanceId,
      driver: ProviderDriverKind.make("acpRegistry"),
      supportsTextGeneration: false,
      enabled: true,
      installed: true,
      version: null,
      status: "ready",
      auth: { status: "authenticated" },
      checkedAt: "2026-07-27T00:00:00.000Z",
      models: [],
      slashCommands: [],
      skills: [],
    } satisfies ServerProvider;

    expect(resolveSourceControlWriterModelSelection(settings, [incapableProvider], null)).toBe(
      settings.textGenerationModelSelection,
    );
    expect(settings.sourceControlWriterModelSelection).toBe(sourceControlWriterModelSelection);
  });

  it("falls back from a writer provider a project turned off, keeping it for other projects", () => {
    const instanceId = ProviderInstanceId.make("codex_writer");
    const projectId = ProjectId.make("project-a");
    const sourceControlWriterModelSelection = createModelSelection(instanceId, "gpt-5.4-mini");
    const settings = {
      ...DEFAULT_SERVER_SETTINGS,
      providerInstances: {
        [instanceId]: { driver: ProviderDriverKind.make("codex"), enabled: true, config: {} },
      },
      projectSettingsOverrides: {
        [projectId]: { providerInstances: { [instanceId]: { enabled: false } } },
      },
      sourceControlWriterModelSelection,
    };
    const provider = {
      instanceId,
      driver: ProviderDriverKind.make("codex"),
      enabled: true,
      installed: true,
      version: null,
      status: "ready",
      auth: { status: "authenticated" },
      checkedAt: "2026-07-27T00:00:00.000Z",
      availability: "available",
      models: [],
      slashCommands: [],
      skills: [],
    } satisfies ServerProvider;

    expect(resolveSourceControlWriterModelSelection(settings, [provider], projectId)).toBe(
      settings.textGenerationModelSelection,
    );
    expect(resolveSourceControlWriterModelSelection(settings, [provider], null)).toBe(
      sourceControlWriterModelSelection,
    );
  });

  it("keeps a writer on an instance the project turned on while the machine has it off", () => {
    const instanceId = ProviderInstanceId.make("codex_writer");
    const projectId = ProjectId.make("project-a");
    const sourceControlWriterModelSelection = createModelSelection(instanceId, "gpt-5.4-mini");
    const settings = {
      ...DEFAULT_SERVER_SETTINGS,
      providerInstances: {
        [instanceId]: { driver: ProviderDriverKind.make("codex"), enabled: false, config: {} },
      },
      projectSettingsOverrides: {
        [projectId]: { providerInstances: { [instanceId]: { enabled: true } } },
      },
      sourceControlWriterModelSelection,
    };
    const provider = {
      instanceId,
      driver: ProviderDriverKind.make("codex"),
      enabled: true,
      installed: true,
      version: null,
      status: "ready",
      auth: { status: "authenticated" },
      checkedAt: "2026-07-27T00:00:00.000Z",
      availability: "available",
      models: [],
      slashCommands: [],
      skills: [],
    } satisfies ServerProvider;

    expect(resolveSourceControlWriterModelSelection(settings, [provider], projectId)).toBe(
      sourceControlWriterModelSelection,
    );
    expect(resolveSourceControlWriterModelSelection(settings, [provider], null)).toBe(
      settings.textGenerationModelSelection,
    );
  });

  it("replaces providerInstances maps so omitted instance fields are cleared", () => {
    const codexId = ProviderInstanceId.make("codex");
    const current = {
      ...DEFAULT_SERVER_SETTINGS,
      providerInstances: {
        [codexId]: {
          driver: ProviderDriverKind.make("codex"),
          displayName: "Codex Work",
          accentColor: "#7c3aed",
          enabled: true,
          config: { homePath: "~/.codex" },
        },
      },
    };

    expect(
      applyServerSettingsPatch(current, {
        providerInstances: {
          [codexId]: {
            driver: ProviderDriverKind.make("codex"),
            displayName: "Codex Work",
            enabled: true,
            config: { homePath: "~/.codex" },
          },
        },
      }).providerInstances[codexId],
    ).toEqual({
      driver: ProviderDriverKind.make("codex"),
      displayName: "Codex Work",
      enabled: true,
      config: { homePath: "~/.codex" },
    });
  });

  it("keeps a project's providerInstances override when a patch entry omits the key", () => {
    const instanceId = ProviderInstanceId.make("codex_work");
    const projectId = ProjectId.make("project-a");
    const current = {
      ...DEFAULT_SERVER_SETTINGS,
      projectSettingsOverrides: {
        [projectId]: {
          newWorktreesStartFromOrigin: true,
          providerInstances: { [instanceId]: { enabled: false } },
        },
      },
    };

    const patched = applyServerSettingsPatch(current, {
      projectSettingsOverrides: {
        [projectId]: { newWorktreesStartFromOrigin: false },
      },
    });

    expect(patched.projectSettingsOverrides[projectId]).toEqual({
      newWorktreesStartFromOrigin: false,
      providerInstances: { [instanceId]: { enabled: false } },
    });
  });

  it("clears a project's providerInstances override when a patch entry sends an empty map", () => {
    const instanceId = ProviderInstanceId.make("codex_work");
    const projectId = ProjectId.make("project-a");
    const current = {
      ...DEFAULT_SERVER_SETTINGS,
      projectSettingsOverrides: {
        [projectId]: {
          newWorktreesStartFromOrigin: true,
          providerInstances: { [instanceId]: { enabled: false } },
        },
      },
    };

    const patched = applyServerSettingsPatch(current, {
      projectSettingsOverrides: {
        [projectId]: { newWorktreesStartFromOrigin: true, providerInstances: {} },
      },
    });

    expect(patched.projectSettingsOverrides[projectId]).toEqual({
      newWorktreesStartFromOrigin: true,
      providerInstances: {},
    });
  });

  describe("project override keys an older client does not know", () => {
    const projectId = ProjectId.make("project-a");
    const reviewGuideModelSelection = createModelSelection(
      ProviderInstanceId.make("codex"),
      "gpt-5.4",
    );
    const addedSinceV26_10_1 = {
      sidebarAutoMarkDoneKeepPullRequests: true,
    } satisfies ProjectSettingsOverrides;
    const rulesAddedSinceV26_10_1 = {
      worktreeDoneAfterDays: 3,
    } satisfies Partial<WorktreeCleanupRules>;
    const stored = {
      defaultAutoPull: false,
      reviewGuideModelSelection,
      reviewGuideInstructions: "Lead with the migration.",
      ...addedSinceV26_10_1,
      worktreeCleanup: {
        mode: "custom" as const,
        rules: {
          worktreeKeepWhen: "any-local-files" as const,
          worktreeAfterDays: 7,
          ...rulesAddedSinceV26_10_1,
          worktreeOnMerge: true,
          worktreeOnDelete: false,
          worktreeUnchanged: false,
        },
      },
    };
    const current = {
      ...DEFAULT_SERVER_SETTINGS,
      projectSettingsOverrides: { [projectId]: stored },
    };

    it("covers every key v26.10.1 clients leave out of the entries they resend", () => {
      const v26_10_1Keys = new Set([
        "worktreeCleanup",
        "defaultModelSelection",
        "defaultRuntimeMode",
        "defaultThreadEnvMode",
        "newWorktreesStartFromOrigin",
        "worktreeSubmodules",
        "defaultAutoPull",
        "defaultProjectScripts",
        "enableAgentBrowserAccess",
        "enableAgentDeviceAccess",
        "textGenerationModelSelection",
        "sourceControlWriterModelSelection",
        "reviewGuideModelSelection",
        "reviewGuideInstructions",
        "sourceControlWritingStyle",
        "removeAgentCreditsOnMerge",
        "branchNamingMode",
        "branchNamePrefix",
        "branchNamePrefixFromRepository",
        "branchNameInstructions",
        "pullRequestMergeMethod",
        "sidebarAutoMarkDoneOnMerge",
        "sidebarAutoMarkDoneAfterDays",
        "continueThreadsAfterServerUpdate",
        "responseStreamingMode",
        "providerInstances",
      ]);
      const v26_10_1RuleKeys = new Set([
        "worktreeKeepWhen",
        "worktreeAfterDays",
        "worktreeOnMerge",
        "worktreeOnDelete",
        "worktreeUnchanged",
      ]);

      expect(
        Object.keys(ProjectSettingsOverrides.fields).filter((key) => !v26_10_1Keys.has(key)),
      ).toEqual(Object.keys(addedSinceV26_10_1));
      expect(
        Object.keys(WorktreeCleanupRules.fields).filter((key) => !v26_10_1RuleKeys.has(key)),
      ).toEqual(Object.keys(rulesAddedSinceV26_10_1));
    });

    it("keeps them when the client resends the entry to edit another key", () => {
      // Decoded the way the server receives it, from a client whose schema predates the keys.
      const patch = decodeServerSettingsPatch({
        projectSettingsOverrides: {
          [projectId]: {
            defaultAutoPull: true,
            worktreeCleanup: {
              mode: "custom",
              rules: {
                worktreeAfterDays: 7,
                worktreeOnMerge: true,
                worktreeOnDelete: false,
                worktreeUnchanged: false,
              },
            },
          },
        },
      });

      expect(applyServerSettingsPatch(current, patch).projectSettingsOverrides[projectId]).toEqual({
        ...stored,
        defaultAutoPull: true,
      });
    });

    it("removes them when a client lists them as removed", () => {
      const {
        reviewGuideModelSelection: _model,
        reviewGuideInstructions: _instructions,
        ...rest
      } = stored;

      const patched = applyServerSettingsPatch(current, {
        projectSettingsOverrides: { [projectId]: rest },
        projectSettingsOverrideRemovals: {
          [projectId]: ["reviewGuideModelSelection", "reviewGuideInstructions"],
        },
      });

      expect(patched.projectSettingsOverrides[projectId]).toEqual(rest);
    });

    it("clears a done-worktree rule a current client sends as null", () => {
      const patch = decodeServerSettingsPatch({
        projectSettingsOverrides: {
          [projectId]: {
            ...stored,
            worktreeCleanup: {
              mode: "custom",
              rules: { ...stored.worktreeCleanup.rules, worktreeDoneAfterDays: null },
            },
          },
        },
      });

      expect(
        applyServerSettingsPatch(current, patch).projectSettingsOverrides[projectId]
          ?.worktreeCleanup,
      ).toEqual({
        mode: "custom",
        rules: { ...stored.worktreeCleanup.rules, worktreeDoneAfterDays: null },
      });
    });
  });

  it("replaces and removes individual usage prices without clobbering other models", () => {
    const prices = { inputCostPerMillionTokens: 2, outputCostPerMillionTokens: 8 };
    const current = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
      usagePriceOverrides: { "example-model": { ...prices, cacheReadCostPerMillionTokens: 0.5 } },
    });
    const added = applyServerSettingsPatch(current, {
      usagePriceOverrides: { "other-model": prices },
    });
    const replaced = applyServerSettingsPatch(added, {
      usagePriceOverrides: { "example-model": prices },
    });
    expect(replaced.usagePriceOverrides).toEqual({
      "example-model": prices,
      "other-model": prices,
    });
    const removed = applyServerSettingsPatch(replaced, {
      usagePriceOverrides: { "example-model": null },
    });
    expect(removed.usagePriceOverrides).toEqual({ "other-model": prices });
    expect(current.usagePriceOverrides["example-model"]?.cacheReadCostPerMillionTokens).toBe(0.5);
  });

  it("stores background activity profiles as a versioned object and syncs legacy aliases", () => {
    const next = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
      backgroundActivity: {
        schemaVersion: 1,
        profile: "battery-saver",
        overrides: {},
      },
    });

    expect(next.backgroundActivity).toEqual({
      schemaVersion: 1,
      profile: "battery-saver",
      overrides: {},
    });
    expect(resolveServerBackgroundActivitySettings(next).profile).toBe("battery-saver");
    expect(
      Duration.toMillis(resolveServerBackgroundActivitySettings(next).automaticGitFetchInterval),
    ).toBe(0);
    expect(
      Duration.toMillis(
        resolveServerBackgroundActivitySettings(next).providerHealthRefreshInterval,
      ),
    ).toBe(Duration.toMillis(Duration.minutes(15)));
  });

  it("turns legacy interval patches into custom background activity overrides", () => {
    const next = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
      automaticGitFetchInterval: Duration.seconds(15),
    });

    expect(next.backgroundActivity).toEqual({
      schemaVersion: 1,
      profile: "custom",
      baseProfile: "balanced",
      overrides: {
        automaticGitFetchInterval: Duration.seconds(15),
      },
    });
    expect(resolveServerBackgroundActivitySettings(next).profile).toBe("balanced");
    expect(
      Duration.toMillis(resolveServerBackgroundActivitySettings(next).automaticGitFetchInterval),
    ).toBe(15_000);
  });

  it("does not reactivate dormant overrides from a concrete profile", () => {
    const current = {
      ...DEFAULT_SERVER_SETTINGS,
      backgroundActivity: {
        schemaVersion: 1 as const,
        profile: "battery-saver" as const,
        overrides: {
          providerHealthRefreshInterval: Duration.seconds(5),
        },
      },
    };

    const next = applyServerSettingsPatch(current, {
      automaticGitFetchInterval: Duration.seconds(15),
    });

    expect(next.backgroundActivity).toEqual({
      schemaVersion: 1,
      profile: "custom",
      baseProfile: "battery-saver",
      overrides: {
        automaticGitFetchInterval: Duration.seconds(15),
      },
    });
  });

  it("prefers a structured background activity patch over interval fields", () => {
    const next = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
      backgroundActivity: {
        schemaVersion: 1,
        profile: "battery-saver",
        overrides: {},
      },
      automaticGitFetchInterval: Duration.seconds(5),
      backgroundActivityProfile: "performance",
    });

    expect(next.backgroundActivity).toEqual({
      schemaVersion: 1,
      profile: "battery-saver",
      overrides: {},
    });
    expect(resolveServerBackgroundActivitySettings(next).profile).toBe("battery-saver");
    expect(
      Duration.toMillis(resolveServerBackgroundActivitySettings(next).automaticGitFetchInterval),
    ).toBe(0);
  });

  it("reconciles custom background activity back to a preset when overrides match the preset", () => {
    const custom = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
      automaticGitFetchInterval: Duration.seconds(15),
    });
    const next = applyServerSettingsPatch(custom, {
      automaticGitFetchInterval: Duration.seconds(30),
    });

    expect(next.backgroundActivity).toEqual({
      schemaVersion: 1,
      profile: "balanced",
      overrides: {},
    });
    expect(resolveServerBackgroundActivitySettings(next).profile).toBe("balanced");
    expect(
      Duration.toMillis(resolveServerBackgroundActivitySettings(next).automaticGitFetchInterval),
    ).toBe(30_000);
  });

  it("drops custom overrides that duplicate the base profile", () => {
    const next = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
      backgroundActivity: {
        schemaVersion: 1,
        profile: "custom",
        baseProfile: "balanced",
        overrides: {
          automaticGitFetchInterval: Duration.seconds(30),
        },
      },
    });

    expect(next.backgroundActivity).toEqual({
      schemaVersion: 1,
      profile: "balanced",
      overrides: {},
    });
  });

  it("replaces the complete background override record", () => {
    const current = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
      backgroundActivity: {
        schemaVersion: 1,
        profile: "custom",
        baseProfile: "balanced",
        overrides: {
          automaticGitFetchInterval: Duration.seconds(15),
          providerHealthRefreshInterval: Duration.minutes(3),
        },
      },
    });

    const next = applyServerSettingsPatch(current, {
      backgroundActivity: {
        overrides: {
          automaticGitFetchInterval: Duration.seconds(10),
        },
      },
    });

    expect(next.backgroundActivity).toEqual({
      schemaVersion: 1,
      profile: "custom",
      baseProfile: "balanced",
      overrides: {
        automaticGitFetchInterval: Duration.seconds(10),
      },
    });
  });

  it("keeps interval overrides supplied with a profile patch", () => {
    const next = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
      backgroundActivityProfile: "performance",
      automaticGitFetchInterval: Duration.seconds(0),
      providerHealthRefreshInterval: Duration.minutes(4),
    });

    expect(next.backgroundActivity).toEqual({
      schemaVersion: 1,
      profile: "custom",
      baseProfile: "performance",
      overrides: {
        automaticGitFetchInterval: Duration.seconds(0),
        providerHealthRefreshInterval: Duration.minutes(4),
      },
    });
  });

  it("ignores overrides attached to a concrete background profile", () => {
    const resolved = resolveServerBackgroundActivitySettings({
      ...DEFAULT_SERVER_SETTINGS,
      backgroundActivity: {
        schemaVersion: 1,
        profile: "balanced",
        overrides: {
          pauseWhenOnBattery: true,
        },
      },
    });

    expect(resolved.pauseWhenOnBattery).toBe(false);
  });
});

describe("worktreesDirectory", () => {
  it("remembers previous custom locations so their worktrees stay managed", () => {
    const first = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, { worktreesDirectory: "/a" });
    expect(first.previousWorktreesDirectories).toEqual([]);
    const second = applyServerSettingsPatch(first, { worktreesDirectory: "/b" });
    expect(second.previousWorktreesDirectories).toEqual(["/a"]);
    const reset = applyServerSettingsPatch(second, { worktreesDirectory: "" });
    expect(reset.previousWorktreesDirectories).toEqual(["/a", "/b"]);
    const back = applyServerSettingsPatch(reset, { worktreesDirectory: "/a" });
    expect(back.previousWorktreesDirectories).toEqual(["/b"]);
  });
});

describe("synchronized model preferences", () => {
  const provider = ProviderInstanceId.make("codex_work");
  const saved = {
    favorites: [{ provider, model: "sol" }],
    providerModelPreferences: { [provider]: { hiddenModels: ["astra"], modelOrder: ["sol"] } },
  };

  it("keeps concurrent adds and removes of the same favorite idempotent", () => {
    const add = { setModelFavorites: [{ provider, model: "sol", favorite: true }] };
    const first = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, add);
    expect(applyServerSettingsPatch(first, add).favorites).toEqual([{ provider, model: "sol" }]);
    const remove = { setModelFavorites: [{ provider, model: "sol", favorite: false }] };
    const removed = applyServerSettingsPatch(first, remove);
    expect(applyServerSettingsPatch(removed, remove).favorites).toEqual([]);
  });

  it("preserves unrelated models and providers during bulk visibility and order edits", () => {
    const otherProvider = ProviderInstanceId.make("claude_work");
    const initial = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
      providerModelPreferences: {
        ...saved.providerModelPreferences,
        [otherProvider]: { hiddenModels: ["opus"], modelOrder: ["sonnet", "opus"] },
      },
    });
    const mobile = applyServerSettingsPatch(initial, {
      setModelsHidden: [{ provider, model: "luna", hidden: true }],
    });
    const web = applyServerSettingsPatch(mobile, {
      setModelsHidden: [
        { provider, model: "astra", hidden: false },
        { provider, model: "sol", hidden: true },
      ],
      setProviderModelOrder: { provider, modelOrder: ["sol", "luna", "astra"] },
    });
    expect(web.providerModelPreferences?.[provider]).toEqual({
      hiddenModels: ["luna", "sol"],
      modelOrder: ["sol", "luna", "astra"],
    });
    expect(web.providerModelPreferences?.[otherProvider]).toEqual(
      initial.providerModelPreferences?.[otherProvider],
    );
    expect(
      applyServerSettingsPatch(web, {
        setProviderModelOrder: { provider, modelOrder: [] },
      }).providerModelPreferences?.[provider],
    ).toEqual({ hiddenModels: ["luna", "sol"], modelOrder: [] });
  });

  it("replaces visibility records so showing every model clears removed entries", () => {
    const current = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, saved);
    const cleared = applyServerSettingsPatch(current, { providerModelPreferences: {} });
    expect(cleared.providerModelPreferences).toEqual({});
    expect(cleared.favorites).toEqual(saved.favorites);
  });

  it("sets favorites without losing changes from other clients", () => {
    const first = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
      setModelFavorites: [{ provider, model: "sol", favorite: true }],
    });
    const second = applyServerSettingsPatch(first, {
      setModelFavorites: [{ provider, model: "astra", favorite: true }],
    });
    expect(second.favorites).toEqual([
      { provider, model: "sol" },
      { provider, model: "astra" },
    ]);
    const removed = applyServerSettingsPatch(second, {
      setModelFavorites: [{ provider, model: "sol", favorite: false }],
    });
    expect(removed.favorites).toEqual([{ provider, model: "astra" }]);
    expect(
      applyServerSettingsPatch(removed, {
        setModelFavorites: [{ provider, model: "astra", favorite: false }],
      }).favorites,
    ).toEqual([]);
  });

  it("sets visibility against the latest state without replacing other models or their order", () => {
    const initial = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
      providerModelPreferences: saved.providerModelPreferences,
    });
    const first = applyServerSettingsPatch(initial, {
      setModelsHidden: [{ provider, model: "sol", hidden: true }],
    });
    const second = applyServerSettingsPatch(first, {
      setModelsHidden: [{ provider, model: "luna", hidden: true }],
    });
    expect(second.providerModelPreferences?.[provider]).toEqual({
      hiddenModels: ["astra", "sol", "luna"],
      modelOrder: ["sol"],
    });
    const restored = applyServerSettingsPatch(second, {
      setModelsHidden: [{ provider, model: "sol", hidden: false }],
    });
    expect(restored.providerModelPreferences?.[provider]).toEqual({
      hiddenModels: ["astra", "luna"],
      modelOrder: ["sol"],
    });
    expect(
      applyServerSettingsPatch(restored, {
        setModelsHidden: [{ provider, model: "sol", hidden: false }],
      }).providerModelPreferences,
    ).toEqual(restored.providerModelPreferences);
    expect(
      applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
        setModelsHidden: [{ provider, model: "sol", hidden: true }],
      }).providerModelPreferences?.[provider]?.hiddenModels,
    ).toEqual(["sol"]);
  });

  it("keeps the same model on different provider instances as separate favorites", () => {
    const otherProvider = ProviderInstanceId.make("codex_personal");
    const first = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
      setModelFavorites: [{ provider, model: "sol", favorite: true }],
    });
    const second = applyServerSettingsPatch(first, {
      setModelFavorites: [{ provider: otherProvider, model: "sol", favorite: true }],
    });
    expect(second.favorites).toEqual([
      { provider, model: "sol" },
      { provider: otherProvider, model: "sol" },
    ]);
    expect(
      applyServerSettingsPatch(second, {
        setModelFavorites: [{ provider, model: "sol", favorite: false }],
      }).favorites,
    ).toEqual([{ provider: otherProvider, model: "sol" }]);
  });
});
