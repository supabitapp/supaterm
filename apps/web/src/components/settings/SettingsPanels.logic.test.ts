import {
  DEFAULT_UNIFIED_SETTINGS,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderInstanceConfig,
} from "@supaterm/contracts";
import * as Duration from "effect/Duration";
import { describe, expect, it } from "vite-plus/test";
import {
  backgroundActivitySharedPolicySettings,
  buildProviderInstanceUpdatePatch,
  getChangedBrowserSettingLabels,
  hasChangedBackgroundActivitySettings,
} from "./SettingsPanels.logic";

describe("background activity settings restore", () => {
  it("detects a changed structured setting", () => {
    expect(hasChangedBackgroundActivitySettings(DEFAULT_UNIFIED_SETTINGS)).toBe(false);
    expect(
      hasChangedBackgroundActivitySettings({
        backgroundActivity: { schemaVersion: 1, profile: "performance", overrides: {} },
      }),
    ).toBe(true);
  });

  it("preserves advanced overrides when the shared policy changes", () => {
    const automaticGitFetchInterval = Duration.seconds(42);
    expect(
      backgroundActivitySharedPolicySettings(
        {
          ...DEFAULT_UNIFIED_SETTINGS,
          backgroundActivity: {
            schemaVersion: 1,
            profile: "custom",
            baseProfile: "balanced",
            overrides: {
              automaticGitFetchInterval,
              pauseWhenOnBattery: true,
            },
          },
        },
        "performance",
      ),
    ).toEqual({
      schemaVersion: 1,
      profile: "custom",
      baseProfile: "performance",
      overrides: {
        automaticGitFetchInterval,
        pauseWhenOnBattery: true,
      },
    });
  });
});

describe("buildProviderInstanceUpdatePatch", () => {
  it("replaces one instance and keeps the others", () => {
    const instanceId = ProviderInstanceId.make("codex");
    const otherId = ProviderInstanceId.make("codex_personal");
    const other = {
      driver: ProviderDriverKind.make("codex"),
      config: { homePath: "/Users/example/.codex-personal" },
    } satisfies ProviderInstanceConfig;
    const nextInstance = {
      driver: ProviderDriverKind.make("codex"),
      enabled: true,
      config: { binaryPath: "/opt/supaterm/codex" },
    } satisfies ProviderInstanceConfig;

    const patch = buildProviderInstanceUpdatePatch({
      settings: { providerInstances: { [otherId]: other } },
      instanceId,
      instance: nextInstance,
    });

    expect(patch.providerInstances).toEqual({ [otherId]: other, [instanceId]: nextInstance });
    expect(patch).not.toHaveProperty("textGenerationModelSelection");
  });
});

describe("getChangedBrowserSettingLabels", () => {
  it("counts a retained custom search URL so restore clears it", () => {
    expect(
      getChangedBrowserSettingLabels({
        ...DEFAULT_UNIFIED_SETTINGS,
        browserCustomSearchUrl: "https://search.example/?q=%s",
      }),
    ).toEqual(["Search engine"]);
  });
});
