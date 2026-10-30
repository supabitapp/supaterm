/**
 * Shared server settings.
 *
 * Every server keeps its own `settings.json`, but some keys are user
 * preferences that only live on the server because the server has to act on
 * them (automatic completion runs with no client attached). A user does not want
 * those to differ per machine. Clients write these keys to every shared-settings
 * sync target, and warn when another target still holds a different value so
 * the user can push their current value out.
 */
import type { EnvironmentId, ServerSettings, ServerSettingsPatch } from "@supaterm/contracts";
import { isModelSelectionProviderEnabled } from "@supaterm/shared/serverSettings";
import * as Equal from "effect/Equal";
import * as Struct from "effect/Struct";

import type { EnvironmentConnectionPhase } from "../connection/presentation.ts";

const SHARED_SERVER_SETTING_KEYS = [
  "continueThreadsAfterServerUpdate",
  "sidebarAutoMarkDoneAfterDays",
  "sidebarAutoMarkDoneOnMerge",
  "sidebarAutoMarkDoneKeepPullRequests",
  "autoResumeLimitedThreads",
  "snoozeLimitedThreads",
  "newWorktreesStartFromOrigin",
  "sourceControlWritingStyle",
  "textGenerationModelSelection",
] as const satisfies ReadonlyArray<keyof ServerSettings & keyof ServerSettingsPatch>;

export type SharedServerSettingKey = (typeof SHARED_SERVER_SETTING_KEYS)[number];

const SHARED_KEY_SET = new Set<string>(SHARED_SERVER_SETTING_KEYS);

export function splitSharedServerPatch(patch: ServerSettingsPatch): {
  sharedPatch: ServerSettingsPatch;
  localPatch: ServerSettingsPatch;
} {
  const sharedPatch: Record<string, unknown> = {};
  const localPatch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (SHARED_KEY_SET.has(key)) {
      sharedPatch[key] = value;
    } else {
      localPatch[key] = value;
    }
  }
  return {
    sharedPatch: sharedPatch as ServerSettingsPatch,
    localPatch: localPatch as ServerSettingsPatch,
  };
}

export function filterSharedServerPatch(
  patch: ServerSettingsPatch,
  settings?: ServerSettings,
  sourceSettings = settings,
  targetIsSource = false,
): ServerSettingsPatch {
  const instanceId =
    patch.textGenerationModelSelection?.instanceId ??
    sourceSettings?.textGenerationModelSelection.instanceId;
  if (
    !targetIsSource &&
    patch.textGenerationModelSelection &&
    (!settings ||
      (instanceId !== undefined &&
        (sourceSettings?.providerInstances[instanceId]?.driver ?? instanceId) !==
          (settings.providerInstances[instanceId]?.driver ?? instanceId)) ||
      !isModelSelectionProviderEnabled(settings, {
        ...settings.textGenerationModelSelection,
        ...patch.textGenerationModelSelection,
      }))
  ) {
    patch = Struct.omit(patch, ["textGenerationModelSelection"]);
  }
  return patch;
}

export function pickSharedServerSettings(settings: ServerSettings): ServerSettingsPatch {
  return filterSharedServerPatch(Struct.pick(settings, SHARED_SERVER_SETTING_KEYS), settings);
}

/** Whether an environment can participate in shared-settings sync right now. */
export function supportsSharedSettingsSync(environment: {
  readonly connection: { readonly phase: EnvironmentConnectionPhase };
  readonly serverConfig: unknown;
}): boolean {
  return environment.connection.phase === "connected" && environment.serverConfig != null;
}

export interface SharedSettingsEnvironment {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly syncEligible: boolean;
  readonly settings: ServerSettings | null;
}

/**
 * Shared-settings sync targets whose values differ from the primary
 * environment's. Other environments are skipped: nothing can be read from or
 * written to them. With no
 * primary settings loaded there is nothing to compare against, so nothing is
 * reported. Callers must pass the real loaded settings, never a default
 * fallback, or "apply to all" would push defaults over real values.
 */
export function findSharedSettingsMismatches(input: {
  readonly primaryEnvironmentId: EnvironmentId | null;
  readonly primarySettings: ServerSettings | null;
  readonly environments: ReadonlyArray<SharedSettingsEnvironment>;
}): ReadonlyArray<{ readonly environmentId: EnvironmentId; readonly label: string }> {
  if (input.primaryEnvironmentId === null || input.primarySettings === null) {
    return [];
  }
  const primarySettings = pickSharedServerSettings(input.primarySettings);
  return input.environments.flatMap((environment) => {
    if (
      environment.environmentId === input.primaryEnvironmentId ||
      !environment.syncEligible ||
      environment.settings === null
    ) {
      return [];
    }
    const expected = filterSharedServerPatch(
      primarySettings,
      environment.settings,
      input.primarySettings ?? undefined,
    );
    let actual = filterSharedServerPatch(
      pickSharedServerSettings(environment.settings),
      environment.settings,
    );
    if (!expected.textGenerationModelSelection) {
      actual = Struct.omit(actual, ["textGenerationModelSelection"]);
    }
    return Equal.equals(actual, expected)
      ? []
      : [{ environmentId: environment.environmentId, label: environment.label }];
  });
}
