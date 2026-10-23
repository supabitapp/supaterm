import {
  AuthSettingsWriteScope,
  DEFAULT_SERVER_SETTINGS,
  PROJECT_SCOPED_SERVER_SETTING_KEYS,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  requiredScopesForServerSettingsPatch,
} from "@supaterm/contracts";
import { describe, expect, it } from "vite-plus/test";
import { createModelSelection } from "./model.ts";
import {
  clearProjectSettingsOverrides,
  hasProjectSettingsOverrides,
  projectSettingsOverridesForWrite,
  resolveNewThreadEnvMode,
  resolveProjectFileBackedSetting,
  resolveProjectSettings,
  resolveSendEnvMode,
  resolveWorktreeCleanup,
  withProjectSettingsOverrides,
} from "./projectSettings.ts";
import { applyServerSettingsPatch } from "./serverSettings.ts";

const projectId = ProjectId.make("project-a");
const otherProjectId = ProjectId.make("project-b");

describe("resolveSendEnvMode", () => {
  it.each(["local", "worktree"] as const)(
    "uses local for non-git projects requesting %s",
    (mode) => {
      expect(resolveSendEnvMode({ requestedEnvMode: mode, isGitRepo: false })).toBe("local");
    },
  );

  it.each(["local", "worktree"] as const)("preserves %s for git repositories", (mode) => {
    expect(resolveSendEnvMode({ requestedEnvMode: mode, isGitRepo: true })).toBe(mode);
  });
});

describe("resolveProjectSettings", () => {
  it("inherits every scopable key when the project has no overrides", () => {
    const resolved = resolveProjectSettings(DEFAULT_SERVER_SETTINGS, projectId);
    expect(resolved.settings).toBe(DEFAULT_SERVER_SETTINGS);
    for (const key of PROJECT_SCOPED_SERVER_SETTING_KEYS) {
      expect(resolved.sources[key]).toBe("environment");
    }
    expect(resolveProjectSettings(DEFAULT_SERVER_SETTINGS, null).settings).toBe(
      DEFAULT_SERVER_SETTINGS,
    );
  });

  it("ignores an override left undefined by a forward-compatible decode", () => {
    const resolved = resolveProjectSettings(
      {
        ...DEFAULT_SERVER_SETTINGS,
        defaultRuntimeMode: "full-access",
        projectSettingsOverrides: { [projectId]: { defaultRuntimeMode: undefined } as never },
      },
      projectId,
    );
    expect(resolved.settings.defaultRuntimeMode).toBe("full-access");
    expect(resolved.sources.defaultRuntimeMode).toBe("environment");
    expect(
      hasProjectSettingsOverrides({
        projectSettingsOverrides: { [projectId]: { defaultRuntimeMode: undefined } as never },
      }),
    ).toBe(false);
  });

  it("treats a null project like an absent one before the shell snapshot arrives", () => {
    expect(resolveProjectSettings(DEFAULT_SERVER_SETTINGS, null, null).settings).toBe(
      DEFAULT_SERVER_SETTINGS,
    );
  });

  it("applies overrides per key and reports their source", () => {
    const settings = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
      defaultAutoPull: true,
      sidebarAutoMarkDoneAfterDays: 3,
      projectSettingsOverrides: {
        [projectId]: { defaultAutoPull: false, sidebarAutoMarkDoneAfterDays: null },
      },
    });
    const resolved = resolveProjectSettings(settings, projectId);
    expect(resolved.settings.defaultAutoPull).toBe(false);
    expect(resolved.settings.sidebarAutoMarkDoneAfterDays).toBeNull();
    expect(resolved.settings.defaultThreadEnvMode).toBe(settings.defaultThreadEnvMode);
    expect(resolved.sources.defaultAutoPull).toBe("project");
    expect(resolved.sources.sidebarAutoMarkDoneAfterDays).toBe("project");
    expect(resolved.sources.defaultThreadEnvMode).toBe("environment");
    expect(resolveProjectSettings(settings, otherProjectId).settings.defaultAutoPull).toBe(true);
  });

  it("keeps the environment text generation model when the override's provider is disabled", () => {
    const disabledSelection = createModelSelection(ProviderInstanceId.make("claudeAgent"), "opus");
    const settings = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
      providerInstances: {
        [ProviderInstanceId.make("claudeAgent")]: {
          driver: ProviderDriverKind.make("claudeAgent"),
          enabled: false,
        },
      },
      projectSettingsOverrides: {
        [projectId]: { textGenerationModelSelection: disabledSelection },
      },
    });
    const resolved = resolveProjectSettings(settings, projectId);
    expect(resolved.settings.textGenerationModelSelection).toEqual(
      settings.textGenerationModelSelection,
    );
    expect(resolved.sources.textGenerationModelSelection).toBe("environment");
  });

  it("honours the aggregate's own fields only until the server has folded them", () => {
    const aggregateModel = createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.5");
    const project = {
      defaultModelSelection: aggregateModel,
      defaultThreadEnvMode: "local" as const,
    };
    const unfolded = resolveProjectSettings(
      { ...DEFAULT_SERVER_SETTINGS, projectSettingsFolded: false },
      projectId,
      project,
    );
    expect(unfolded.settings.defaultModelSelection).toEqual(aggregateModel);
    expect(unfolded.settings.defaultThreadEnvMode).toBe("local");
    expect(unfolded.sources.defaultModelSelection).toBe("project");
    const overridden = resolveProjectSettings(
      {
        ...DEFAULT_SERVER_SETTINGS,
        projectSettingsFolded: false,
        projectSettingsOverrides: { [projectId]: { defaultThreadEnvMode: "worktree" } },
      },
      projectId,
      project,
    );
    expect(overridden.settings.defaultThreadEnvMode).toBe("worktree");
    const folded = resolveProjectSettings(
      { ...DEFAULT_SERVER_SETTINGS, projectSettingsFolded: true },
      projectId,
      project,
    );
    expect(folded.settings.defaultModelSelection).toBeNull();
    expect(folded.sources.defaultModelSelection).toBe("environment");
  });

  it("keeps the environment default model when the override's provider is disabled", () => {
    const disabledSelection = createModelSelection(ProviderInstanceId.make("claudeAgent"), "opus");
    const settings = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
      providerInstances: {
        [ProviderInstanceId.make("claudeAgent")]: {
          driver: ProviderDriverKind.make("claudeAgent"),
          enabled: false,
        },
      },
      projectSettingsOverrides: { [projectId]: { defaultModelSelection: disabledSelection } },
    });
    const resolved = resolveProjectSettings(settings, projectId);
    expect(resolved.settings.defaultModelSelection).toBeNull();
    expect(resolved.sources.defaultModelSelection).toBe("environment");
  });

  it("moves text generation off an instance the project turned off", () => {
    const codex = ProviderInstanceId.make("codex");
    const settings = {
      ...DEFAULT_SERVER_SETTINGS,
      textGenerationModelSelection: createModelSelection(codex, "gpt-5"),
      projectSettingsOverrides: {
        [projectId]: { providerInstances: { [codex]: { enabled: false } } },
      },
    };
    expect(
      resolveProjectSettings(settings, projectId).settings.textGenerationModelSelection.instanceId,
    ).toBe(ProviderInstanceId.make("claudeAgent"));
    expect(
      resolveProjectSettings(settings, otherProjectId).settings.textGenerationModelSelection,
    ).toEqual(settings.textGenerationModelSelection);
  });

  it("falls back to a configured instance when every built-in one is off for the project", () => {
    const codex = ProviderInstanceId.make("codex");
    const codexWork = ProviderInstanceId.make("codex_work");
    const settings = {
      ...DEFAULT_SERVER_SETTINGS,
      textGenerationModelSelection: createModelSelection(codex, "gpt-5"),
      providerInstances: { [codexWork]: { driver: ProviderDriverKind.make("codex"), config: {} } },
      projectSettingsOverrides: {
        [projectId]: {
          providerInstances: {
            [codex]: { enabled: false },
            [ProviderInstanceId.make("claudeAgent")]: { enabled: false },
          },
        },
      },
    };
    expect(
      resolveProjectSettings(settings, projectId).settings.textGenerationModelSelection.instanceId,
    ).toBe(codexWork);
  });
});

describe("resolveProjectSettings with a supaterm.json", () => {
  it("walks project override, environment value, file, then built-in for file-backed keys", () => {
    const file = { defaultThreadEnvMode: "worktree" as const };
    const fromOverride = resolveProjectSettings(
      {
        ...DEFAULT_SERVER_SETTINGS,
        projectSettingsOverrides: { [projectId]: { defaultThreadEnvMode: "local" } },
      },
      projectId,
      null,
      file,
    );
    expect(fromOverride.settings.defaultThreadEnvMode).toBe("local");
    expect(fromOverride.sources.defaultThreadEnvMode).toBe("project");

    const fromEnvironment = resolveProjectSettings(
      { ...DEFAULT_SERVER_SETTINGS, defaultThreadEnvMode: "local" },
      projectId,
      null,
      file,
    );
    expect(fromEnvironment.settings.defaultThreadEnvMode).toBe("local");
    expect(fromEnvironment.sources.defaultThreadEnvMode).toBe("environment");

    const fromFile = resolveProjectSettings(DEFAULT_SERVER_SETTINGS, projectId, null, file);
    expect(fromFile.settings.defaultThreadEnvMode).toBe("worktree");
    expect(fromFile.sources.defaultThreadEnvMode).toBe("supaterm.json");

    const builtIn = resolveProjectSettings(DEFAULT_SERVER_SETTINGS, projectId, null, null);
    expect(builtIn.settings.defaultThreadEnvMode).toBe("local");
    expect(builtIn.sources.defaultThreadEnvMode).toBe("environment");
    const nullOverride = resolveProjectSettings(
      {
        ...DEFAULT_SERVER_SETTINGS,
        projectSettingsOverrides: { [projectId]: { defaultThreadEnvMode: null } as never },
      },
      projectId,
      null,
      file,
    );
    expect(nullOverride.settings.defaultThreadEnvMode).toBe("worktree");
    expect(nullOverride.sources.defaultThreadEnvMode).toBe("supaterm.json");
    expect(
      resolveProjectSettings(DEFAULT_SERVER_SETTINGS, projectId, null, {}).sources
        .defaultThreadEnvMode,
    ).toBe("environment");
  });

  it("resolves one key from the settings tier, then the file, then the built-in", () => {
    expect(
      resolveProjectFileBackedSetting("worktreeSubmodules", "none", {
        worktreeSubmodules: "top-level",
      }),
    ).toEqual({ value: "none", source: "environment" });
    expect(
      resolveProjectFileBackedSetting("worktreeSubmodules", null, {
        worktreeSubmodules: "top-level",
      }),
    ).toEqual({ value: "top-level", source: "supaterm.json" });
    expect(resolveProjectFileBackedSetting("worktreeSubmodules", null, null)).toEqual({
      value: "recursive",
      source: "environment",
    });
  });

  it("leaves settings untouched when no file is passed", () => {
    expect(resolveProjectSettings(DEFAULT_SERVER_SETTINGS, projectId).settings).toBe(
      DEFAULT_SERVER_SETTINGS,
    );
  });
});

describe("resolveNewThreadEnvMode", () => {
  const worktreeEnvironment = resolveProjectSettings(
    { ...DEFAULT_SERVER_SETTINGS, defaultThreadEnvMode: "worktree" },
    projectId,
    null,
    null,
  );
  const newProject = {
    projectSettings: worktreeEnvironment,
    workspaceRoot: "/data/projects/pinball-stats",
    newProjectsRoot: "/data/projects/",
    projectHasThreads: false,
  };

  it("starts a new project's first thread in its checkout", () => {
    expect(resolveNewThreadEnvMode(newProject)).toBe("local");
    expect(
      resolveNewThreadEnvMode({
        ...newProject,
        workspaceRoot: "C:\\Data\\Projects\\Pinball-Stats",
        newProjectsRoot: "c:/data/projects",
      }),
    ).toBe("local");
  });

  it("keeps the configured default once the project has a thread or is not a new project", () => {
    expect(resolveNewThreadEnvMode({ ...newProject, projectHasThreads: true })).toBe("worktree");
    expect(resolveNewThreadEnvMode({ ...newProject, workspaceRoot: "/data/projects" })).toBe(
      "worktree",
    );
    expect(
      resolveNewThreadEnvMode({ ...newProject, workspaceRoot: "/data/projects/a/nested" }),
    ).toBe("worktree");
    expect(resolveNewThreadEnvMode({ ...newProject, workspaceRoot: "/data/projects-old/a" })).toBe(
      "worktree",
    );
    expect(resolveNewThreadEnvMode({ ...newProject, newProjectsRoot: undefined })).toBe("worktree");
  });

  it("lets a project override, or a supaterm.json the environment defers to, keep worktree mode", () => {
    for (const projectSettings of [
      resolveProjectSettings(
        {
          ...DEFAULT_SERVER_SETTINGS,
          projectSettingsOverrides: { [projectId]: { defaultThreadEnvMode: "worktree" } },
        },
        projectId,
        null,
        null,
      ),
      resolveProjectSettings(DEFAULT_SERVER_SETTINGS, projectId, null, {
        defaultThreadEnvMode: "worktree",
      }),
    ]) {
      expect(resolveNewThreadEnvMode({ ...newProject, projectSettings })).toBe("worktree");
    }
  });
});

describe("projectSettingsOverrides patches", () => {
  it("replaces a project's entry, removes it with null, and drops empty entries", () => {
    const first = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
      projectSettingsOverrides: {
        [projectId]: { defaultAutoPull: true, enableAgentBrowserAccess: false },
        [otherProjectId]: { defaultAutoPull: false },
      },
    });
    expect(hasProjectSettingsOverrides(first)).toBe(true);
    const replaced = applyServerSettingsPatch(first, {
      projectSettingsOverrides: { [projectId]: { enableAgentBrowserAccess: false } },
    });
    expect(replaced.projectSettingsOverrides[projectId]).toEqual({
      enableAgentBrowserAccess: false,
    });
    expect(replaced.projectSettingsOverrides[otherProjectId]).toEqual({ defaultAutoPull: false });
    const emptied = applyServerSettingsPatch(replaced, {
      projectSettingsOverrides: { [projectId]: {} },
    });
    expect(emptied.projectSettingsOverrides[projectId]).toBeUndefined();
    const removed = applyServerSettingsPatch(replaced, {
      projectSettingsOverrides: { [projectId]: null },
    });
    expect(removed.projectSettingsOverrides).toEqual({
      [otherProjectId]: { defaultAutoPull: false },
    });
    expect(hasProjectSettingsOverrides(DEFAULT_SERVER_SETTINGS)).toBe(false);
  });

  it("edits a project's other overrides without its provider switches or their grant", () => {
    const providerInstances = { [ProviderInstanceId.make("codex_work")]: { enabled: false } };
    const settings = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
      projectSettingsOverrides: { [projectId]: { defaultAutoPull: true, providerInstances } },
    });
    const edited = {
      ...projectSettingsOverridesForWrite(settings, projectId),
      defaultThreadEnvMode: "local" as const,
    };
    const cleared = clearProjectSettingsOverrides(settings, projectId, ["defaultAutoPull"]);

    for (const entry of [edited, cleared]) {
      const patch = { projectSettingsOverrides: { [projectId]: entry } };
      expect(requiredScopesForServerSettingsPatch(patch)).toEqual([AuthSettingsWriteScope]);
      expect(
        applyServerSettingsPatch(settings, patch).projectSettingsOverrides[projectId]
          ?.providerInstances,
      ).toEqual(providerInstances);
    }
  });

  it("builds replacement entries and clears individual keys", () => {
    const settings = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
      projectSettingsOverrides: {
        [projectId]: { defaultAutoPull: true, enableAgentBrowserAccess: false },
      },
    });
    expect(clearProjectSettingsOverrides(settings, projectId, ["defaultAutoPull"])).toEqual({
      enableAgentBrowserAccess: false,
    });
    expect(
      clearProjectSettingsOverrides(settings, projectId, [
        "defaultAutoPull",
        "enableAgentBrowserAccess",
      ]),
    ).toBeNull();
    expect(clearProjectSettingsOverrides(settings, otherProjectId, ["defaultAutoPull"])).toBeNull();
    expect(withProjectSettingsOverrides(settings, projectId, null)).toEqual({});
    expect(
      withProjectSettingsOverrides(settings, otherProjectId, { defaultThreadEnvMode: "worktree" }),
    ).toEqual({
      ...settings.projectSettingsOverrides,
      [otherProjectId]: { defaultThreadEnvMode: "worktree" },
    });
  });
});

describe("resolveWorktreeCleanup", () => {
  it("inherits machine rules, disables one project and keeps custom rules isolated", () => {
    const machine = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
      storageCleanup: {
        worktreeAfterDays: 8,
        worktreeDoneAfterDays: 2,
        worktreeKeepWhen: "any-local-files",
        worktreeOnDelete: true,
        logsAfterDays: 3,
      },
    });
    const inherited = resolveWorktreeCleanup(machine, projectId);
    expect(inherited).toMatchObject({
      worktreeDoneAfterDays: 2,
      worktreeKeepWhen: "any-local-files",
    });
    const off = applyServerSettingsPatch(machine, {
      projectSettingsOverrides: {
        [projectId]: { worktreeCleanup: { mode: "off" } },
      },
    });
    expect(resolveWorktreeCleanup(off, projectId)).toEqual({
      worktreeAfterDays: null,
      worktreeDoneAfterDays: null,
      worktreeOnDelete: false,
      worktreeOnMerge: false,
      worktreeUnchanged: false,
      worktreeKeepWhen: "any-local-files",
    });
    expect(resolveWorktreeCleanup(off, otherProjectId)).toEqual(inherited);
    const custom = applyServerSettingsPatch(off, {
      projectSettingsOverrides: {
        [projectId]: {
          worktreeCleanup: {
            mode: "custom",
            rules: { ...inherited, worktreeAfterDays: 15, worktreeDoneAfterDays: 0 },
          },
        },
      },
    });
    expect(resolveWorktreeCleanup(custom, projectId).worktreeAfterDays).toBe(15);
    expect(resolveWorktreeCleanup(custom, projectId).worktreeDoneAfterDays).toBe(0);
    expect(resolveWorktreeCleanup(custom, otherProjectId)).toEqual(inherited);
    expect(custom.storageCleanup.logsAfterDays).toBe(3);
    const reset = applyServerSettingsPatch(custom, {
      projectSettingsOverrides: {
        [projectId]: clearProjectSettingsOverrides(custom, projectId, ["worktreeCleanup"]),
      },
    });
    expect(resolveWorktreeCleanup(reset, projectId)).toEqual(inherited);
  });
  it("completes partial machine custom rules and preserves them across edits", () => {
    const initial = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
      storageCleanup: { worktreeAfterDays: 8, worktreeDoneAfterDays: 0, worktreeOnDelete: true },
    });
    const custom = applyServerSettingsPatch(initial, {
      worktreeCleanup: { mode: "custom", rules: { worktreeOnMerge: true } },
    });
    const edited = applyServerSettingsPatch(custom, {
      worktreeCleanup: { mode: "custom", rules: { worktreeAfterDays: 15 } },
    });
    expect(resolveWorktreeCleanup(edited, null)).toEqual({
      worktreeAfterDays: 15,
      worktreeDoneAfterDays: 0,
      worktreeOnDelete: true,
      worktreeOnMerge: true,
      worktreeUnchanged: true,
      worktreeKeepWhen: "uncommitted-changes",
    });
    expect(
      resolveWorktreeCleanup(applyServerSettingsPatch(edited, { worktreeCleanup: null }), null)
        .worktreeAfterDays,
    ).toBe(8);
  });
});

it("inherits branch naming defaults and applies project overrides independently", () => {
  const settings = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
    branchNamingMode: "static",
    branchNamePrefix: "team/",
    branchNameInstructions: "Use issue IDs.",
    projectSettingsOverrides: { [projectId]: { branchNamingMode: "custom" } },
  });
  expect(resolveProjectSettings(settings, projectId).settings).toMatchObject({
    branchNamingMode: "custom",
    branchNamePrefix: "team/",
    branchNameInstructions: "Use issue IDs.",
  });
  expect(resolveProjectSettings(settings, otherProjectId).settings).toMatchObject({
    branchNamingMode: "static",
    branchNamePrefix: "team/",
  });
  const cleared = applyServerSettingsPatch(settings, {
    projectSettingsOverrides: {
      [projectId]: clearProjectSettingsOverrides(settings, projectId, ["branchNamingMode"]),
    },
  });
  expect(resolveProjectSettings(cleared, projectId).settings.branchNamingMode).toBe("static");
});
