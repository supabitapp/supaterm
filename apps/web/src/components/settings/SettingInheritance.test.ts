import { DEFAULT_SERVER_SETTINGS, EnvironmentId, ProjectId } from "@supaterm/contracts";
import { resolveProjectSettings } from "@supaterm/shared/projectSettings";
import { describe, expect, it } from "vite-plus/test";

import { settingInheritanceLayers } from "./SettingInheritance";

const environmentId = EnvironmentId.make("laptop");
const projectId = ProjectId.make("project");

describe("settingInheritanceLayers", () => {
  it("marks the built-in default effective when nothing is set", () => {
    const resolved = resolveProjectSettings(DEFAULT_SERVER_SETTINGS, null);
    const layers = settingInheritanceLayers(
      { environmentId, label: "Laptop", projectId: null, ...resolved },
      DEFAULT_SERVER_SETTINGS,
      "defaultAutoPull",
    );
    expect(layers.map((layer) => [layer.label, layer.value, layer.effective])).toEqual([
      ["Laptop", "Inherits", false],
      ["Default", "On", true],
    ]);
  });

  it("walks project override, environment value, then built-in default", () => {
    const settings = {
      ...DEFAULT_SERVER_SETTINGS,
      defaultAutoPull: false,
      projectSettingsOverrides: { [projectId]: { defaultAutoPull: true } },
    };
    const resolved = resolveProjectSettings(settings, projectId);
    const layers = settingInheritanceLayers(
      { environmentId, label: "Laptop", projectId, ...resolved },
      settings,
      "defaultAutoPull",
    );
    expect(layers.map((layer) => [layer.label, layer.value, layer.effective])).toEqual([
      ["Project", "On", true],
      ["Laptop", "Off", false],
      ["Default", "On", false],
    ]);
    const inherited = settingInheritanceLayers(
      {
        environmentId,
        label: "Laptop",
        projectId,
        ...resolveProjectSettings(settings, ProjectId.make("other")),
      },
      settings,
      "defaultAutoPull",
    );
    expect(inherited.map((layer) => [layer.value, layer.effective])).toEqual([
      ["Inherits", false],
      ["Off", true],
      ["On", false],
    ]);
  });

  it("identifies the background activity profile supplied by each layer", () => {
    const settings = {
      ...DEFAULT_SERVER_SETTINGS,
      backgroundActivity: {
        schemaVersion: 1 as const,
        profile: "performance" as const,
        overrides: {},
      },
    };
    const layers = settingInheritanceLayers(
      {
        environmentId,
        label: "Laptop",
        projectId: null,
        ...resolveProjectSettings(settings, projectId),
      },
      settings,
      "backgroundActivity",
    );
    expect(layers.map((layer) => [layer.key, layer.value, layer.effective])).toEqual([
      ["environment", "Performance", true],
      ["built-in", "Balanced", false],
    ]);
  });

  it("shows the checkout's supaterm.json as a layer for file-backed keys", () => {
    const file = { defaultThreadEnvMode: "worktree" as const };
    const fromFile = settingInheritanceLayers(
      {
        environmentId,
        label: "Laptop",
        projectId,
        ...resolveProjectSettings(DEFAULT_SERVER_SETTINGS, projectId, null, file),
      },
      DEFAULT_SERVER_SETTINGS,
      "defaultThreadEnvMode",
    );
    expect(fromFile.map((layer) => [layer.label, layer.value, layer.effective])).toEqual([
      ["Project", "Inherits", false],
      ["Laptop", "Inherits", false],
      ["supaterm.json", "New worktree", true],
      ["Default", "Current checkout", false],
    ]);
    const settings = { ...DEFAULT_SERVER_SETTINGS, defaultThreadEnvMode: "local" as const };
    const fromEnvironment = settingInheritanceLayers(
      {
        environmentId,
        label: "Laptop",
        projectId,
        ...resolveProjectSettings(settings, projectId, null, file),
      },
      settings,
      "defaultThreadEnvMode",
    );
    expect(fromEnvironment.map((layer) => [layer.value, layer.effective])).toEqual([
      ["Inherits", false],
      ["Current checkout", true],
      ["Inherits", false],
      ["Current checkout", false],
    ]);
  });
});
