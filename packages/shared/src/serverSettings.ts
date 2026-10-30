import type { ModelPreferences } from "@supaterm/contracts/settings";
import {
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_TEXT_GENERATION_MODEL,
  DEFAULT_TEXT_GENERATION_MODEL_BY_PROVIDER,
  defaultInstanceIdForDriver,
  isProviderAvailable,
  isUnconfiguredDefaultInstanceEnabled,
  resolveProjectProviderInstanceEnabled,
  resolveProviderInstanceEnabled,
  isProviderTextGenerationCapable,
  isProviderReviewGuideCapable,
  type ModelSelection,
  type ProjectId,
  type ProjectScopedServerSettingKey,
  ProjectSettingsOverrides,
  type ProjectSettingsOverridesPatchEntry,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  ServerSettings,
  ServerSettingsPatch,
} from "@supaterm/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import { deepMerge } from "./Struct.ts";
import { fromLenientJson } from "./schemaJson.ts";
import { createModelSelection, readCustomModelEntries } from "./model.ts";
import {
  getBackgroundActivityBaseProfile,
  normalizeBackgroundActivitySettings,
  normalizeServerBackgroundActivitySettings,
} from "./backgroundActivitySettings.ts";

const ServerSettingsJson = fromLenientJson(ServerSettings);
const decodeServerSettingsJson = Schema.decodeUnknownOption(ServerSettingsJson);

export function isModelSelectionProviderEnabled(
  settings: ServerSettings,
  selection: ModelSelection,
): boolean {
  const instanceConfig = settings.providerInstances[selection.instanceId];
  if (instanceConfig !== undefined) {
    return resolveProviderInstanceEnabled(instanceConfig);
  }

  return isUnconfiguredDefaultInstanceEnabled(selection.instanceId);
}

const TEXT_GENERATION_FALLBACK_DRIVERS = [
  "codex",
  "claudeAgent",
  "cursor",
  "grok",
  "muse",
  "pi",
  "opencode",
  "antigravity",
].map((driver) => ProviderDriverKind.make(driver));

/** Project-scoped fallback includes custom instances when built-ins are disabled.
 * Machine-scoped callers omit this option to preserve their candidate set. */
export function fallbackTextGenerationModelSelection(
  providerInstances: ServerSettings["providerInstances"],
  isEnabled: (instanceId: ProviderInstanceId, driver: ProviderDriverKind) => boolean,
  options?: {
    readonly includeConfiguredInstances?: boolean;
    readonly defaultModelSelection?: ModelSelection | null;
  },
): ModelSelection | null {
  const candidates = [
    ...TEXT_GENERATION_FALLBACK_DRIVERS.map(
      (driver) => [defaultInstanceIdForDriver(driver), driver] as const,
    ),
    ...(options?.includeConfiguredInstances === true
      ? Object.entries(providerInstances).flatMap(([instanceId, instance]) =>
          TEXT_GENERATION_FALLBACK_DRIVERS.includes(instance.driver)
            ? [[ProviderInstanceId.make(instanceId), instance.driver] as const]
            : [],
        )
      : []),
  ];
  const match = candidates.find(([instanceId, driver]) => isEnabled(instanceId, driver));
  if (match === undefined) return null;
  const [instanceId, driver] = match;
  const threadDefault = options?.defaultModelSelection;
  const config = providerInstances[instanceId]?.config as { customModels?: unknown } | undefined;
  if (
    threadDefault?.instanceId === instanceId &&
    readCustomModelEntries(config?.customModels).some((entry) => entry.slug === threadDefault.model)
  ) {
    return threadDefault;
  }
  return { instanceId, model: defaultTextGenerationModel(driver) };
}

function defaultTextGenerationModel(driver: ProviderDriverKind): string {
  return (
    DEFAULT_TEXT_GENERATION_MODEL_BY_PROVIDER[driver] ??
    DEFAULT_MODEL_BY_PROVIDER[driver] ??
    DEFAULT_TEXT_GENERATION_MODEL
  );
}

export function resolveSourceControlWriterModelSelection(
  settings: ServerSettings,
  providers: ReadonlyArray<ServerProvider> | undefined,
  projectId: ProjectId | null,
): ModelSelection {
  const selection = settings.sourceControlWriterModelSelection;
  if (
    !selection ||
    !resolveProjectProviderInstanceEnabled(settings, projectId, selection.instanceId)
  ) {
    return settings.textGenerationModelSelection;
  }
  if (providers === undefined) {
    return selection;
  }

  const provider = providers.find((candidate) => candidate.instanceId === selection.instanceId);
  return provider?.enabled === true &&
    isProviderAvailable(provider) &&
    isProviderTextGenerationCapable(provider)
    ? selection
    : settings.textGenerationModelSelection;
}

export function resolveReviewGuideModelSelection(
  settings: ServerSettings,
  providers: ReadonlyArray<ServerProvider> | undefined,
  projectId: ProjectId | null,
): ModelSelection {
  const preferences = [
    settings.reviewGuideModelSelection,
    resolveSourceControlWriterModelSelection(settings, providers, projectId),
    settings.textGenerationModelSelection,
  ];
  for (const selection of preferences) {
    if (
      !selection ||
      !resolveProjectProviderInstanceEnabled(settings, projectId, selection.instanceId)
    )
      continue;
    const provider = providers?.find((candidate) => candidate.instanceId === selection.instanceId);
    if (
      providers === undefined ||
      (provider && isProviderAvailable(provider) && isProviderReviewGuideCapable(provider))
    )
      return selection;
  }
  const fallback = providers?.find(
    (provider) =>
      resolveProjectProviderInstanceEnabled(settings, projectId, provider.instanceId) &&
      isProviderAvailable(provider) &&
      isProviderReviewGuideCapable(provider) &&
      provider.models.length > 0,
  );
  if (fallback) {
    const model = fallback.models.find((candidate) => candidate.isDefault) ?? fallback.models[0]!;
    return createModelSelection(fallback.instanceId, model.slug);
  }
  return resolveSourceControlWriterModelSelection(settings, providers, projectId);
}

export interface PersistedServerObservabilitySettings {
  readonly otlpTracesUrl: string | undefined;
  readonly otlpMetricsUrl: string | undefined;
  readonly otlpLogsUrl: string | undefined;
}

function normalizePersistedServerSettingString(
  value: string | null | undefined,
): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function extractPersistedServerObservabilitySettings(input: {
  readonly observability?: {
    readonly otlpTracesUrl?: string;
    readonly otlpMetricsUrl?: string;
    readonly otlpLogsUrl?: string;
  };
}): PersistedServerObservabilitySettings {
  return {
    otlpTracesUrl: normalizePersistedServerSettingString(input.observability?.otlpTracesUrl),
    otlpMetricsUrl: normalizePersistedServerSettingString(input.observability?.otlpMetricsUrl),
    otlpLogsUrl: normalizePersistedServerSettingString(input.observability?.otlpLogsUrl),
  };
}

export function parsePersistedServerObservabilitySettings(
  raw: string,
): PersistedServerObservabilitySettings {
  const decoded = decodeServerSettingsJson(raw);
  if (Option.isSome(decoded)) {
    return extractPersistedServerObservabilitySettings(decoded.value);
  }
  return { otlpTracesUrl: undefined, otlpMetricsUrl: undefined, otlpLogsUrl: undefined };
}

function shouldReplaceTextGenerationModelSelection(
  patch: ServerSettingsPatch["textGenerationModelSelection"] | undefined,
): boolean {
  return Boolean(patch && (patch.instanceId !== undefined || patch.model !== undefined));
}

function mergeModelSelectionOptionsById(input: {
  current: ReadonlyArray<{ readonly id: string; readonly value: string | boolean }> | undefined;
  patch: ReadonlyArray<{ readonly id: string; readonly value: string | boolean }> | undefined;
}): Array<{ id: string; value: string | boolean }> | undefined {
  if (input.patch === undefined) {
    return input.current ? [...input.current] : undefined;
  }
  if (input.patch.length === 0) {
    return undefined;
  }

  const merged = new Map((input.current ?? []).map((selection) => [selection.id, selection.value]));
  for (const selection of input.patch) {
    merged.set(selection.id, selection.value);
  }
  return [...merged.entries()].map(([id, value]) => ({ id, value }));
}

function mergeSettingsEntries<Value>(
  current: Readonly<Record<string, Value>>,
  patch: Readonly<Record<string, Value | null>>,
): Record<string, Value> {
  const next = new Map(Object.entries(current));
  for (const [id, config] of Object.entries(patch)) {
    if (config === null) {
      next.delete(id);
    } else {
      next.set(id, config);
    }
  }
  return Object.fromEntries(next);
}

/** Override keys added after clients already round-tripped a project's whole entry. */
const knownProjectOverrideKeys = new Set(Object.keys(ProjectSettingsOverrides.fields));

const OVERRIDE_KEYS_OLDER_CLIENTS_OMIT = [
  "providerInstances",
  "threadTitleInstructions",
  "reviewGuideModelSelection",
  "reviewGuideInstructions",
  "sidebarAutoMarkDoneKeepPullRequests",
] as const;

function withStoredWorktreeRules(
  incoming: NonNullable<ProjectSettingsOverridesPatchEntry["worktreeCleanup"]> | null,
  stored: ProjectSettingsOverrides["worktreeCleanup"],
): NonNullable<ProjectSettingsOverrides["worktreeCleanup"]> | null {
  if (incoming === null || incoming.mode === "off") return incoming;
  const storedRules = stored?.mode === "custom" ? stored.rules : undefined;
  const worktreeKeepWhen =
    incoming.rules.worktreeKeepWhen ?? storedRules?.worktreeKeepWhen ?? "uncommitted-changes";
  const worktreeDoneAfterDays =
    incoming.rules.worktreeDoneAfterDays === undefined
      ? (storedRules?.worktreeDoneAfterDays ?? null)
      : incoming.rules.worktreeDoneAfterDays;
  return { mode: "custom", rules: { ...incoming.rules, worktreeKeepWhen, worktreeDoneAfterDays } };
}

/** Older clients resend whole entries without recently added fields.
 * Preserve their stored values until an explicit empty value or removal clears them. */
function mergeProjectSettingsOverridesPatch(
  current: Readonly<Record<string, ProjectSettingsOverrides>>,
  patch: Readonly<Record<string, ProjectSettingsOverridesPatchEntry | null>>,
  removals: Readonly<Record<string, ReadonlyArray<ProjectScopedServerSettingKey>>>,
): Record<string, ProjectSettingsOverrides> {
  const next = new Map(Object.entries(current));
  for (const [projectId, entry] of Object.entries(patch)) {
    if (entry === null) {
      next.delete(projectId);
      continue;
    }
    const stored = current[projectId];
    const { worktreeCleanup, ...rest } = entry;
    next.set(projectId, {
      ...Object.fromEntries(
        Object.entries(stored ?? {}).filter(([key]) => !knownProjectOverrideKeys.has(key)),
      ),
      ...(stored === undefined ? {} : Struct.pick(stored, OVERRIDE_KEYS_OLDER_CLIENTS_OMIT)),
      ...Object.fromEntries(
        Object.entries(rest).filter(([key]) => knownProjectOverrideKeys.has(key)),
      ),
      ...(worktreeCleanup === undefined
        ? {}
        : {
            worktreeCleanup: withStoredWorktreeRules(worktreeCleanup, stored?.worktreeCleanup),
          }),
    });
  }
  for (const [projectId, keys] of Object.entries(removals)) {
    const entry = next.get(projectId);
    if (entry !== undefined) next.set(projectId, Struct.omit(entry, keys));
  }
  return Object.fromEntries(next);
}

export function applyServerSettingsPatch(
  current: ServerSettings,
  patch: ServerSettingsPatch,
): ServerSettings {
  const selectionPatch = patch.textGenerationModelSelection;
  const {
    setModelFavorites,
    setModelsHidden,
    setProviderModelOrder,
    providerModelPreferences,
    automaticGitFetchInterval,
    providerHealthRefreshInterval,
    backgroundActivityProfile,
    backgroundActivity,
    worktreeCleanup: worktreeCleanupPatch,
    secretProviders: secretProvidersPatch,
    sourceControlHosts: hostSettingsPatch,
    usagePriceOverrides: usagePriceOverridesPatch,
    usageModelAliases: usageModelAliasesPatch,
    // Entry replacement: deepMerge would keep keys the client meant to clear.
    projectSettingsOverrides: projectSettingsOverridesPatch,
    projectSettingsOverrideRemovals,
    ...patchForMerge
  } = patch;
  const currentBackgroundActivity = normalizeServerBackgroundActivitySettings(current);
  const backgroundActivityPatch =
    backgroundActivityProfile !== undefined
      ? {
          schemaVersion: 1 as const,
          profile:
            automaticGitFetchInterval !== undefined || providerHealthRefreshInterval !== undefined
              ? ("custom" as const)
              : backgroundActivityProfile,
          ...(automaticGitFetchInterval !== undefined || providerHealthRefreshInterval !== undefined
            ? { baseProfile: backgroundActivityProfile }
            : {}),
          overrides: {
            ...(automaticGitFetchInterval !== undefined ? { automaticGitFetchInterval } : {}),
            ...(providerHealthRefreshInterval !== undefined
              ? { providerHealthRefreshInterval }
              : {}),
          },
        }
      : automaticGitFetchInterval !== undefined || providerHealthRefreshInterval !== undefined
        ? {
            schemaVersion: 1 as const,
            profile: "custom" as const,
            baseProfile: getBackgroundActivityBaseProfile(currentBackgroundActivity),
            overrides: {
              ...(currentBackgroundActivity.profile === "custom"
                ? currentBackgroundActivity.overrides
                : {}),
              ...(automaticGitFetchInterval !== undefined ? { automaticGitFetchInterval } : {}),
              ...(providerHealthRefreshInterval !== undefined
                ? { providerHealthRefreshInterval }
                : {}),
            },
          }
        : undefined;
  const initialFavorites = patch.favorites ?? current.favorites;
  let favorites = initialFavorites;
  if (setModelFavorites !== undefined) {
    let edited = [...initialFavorites];
    for (const change of setModelFavorites) {
      const matches = (favorite: ModelPreferences["favorites"][number]) =>
        favorite.provider === change.provider && favorite.model === change.model;
      if (!change.favorite) {
        edited = edited.filter((favorite) => !matches(favorite));
      } else if (!edited.some(matches)) {
        edited.push({ provider: change.provider, model: change.model });
      }
    }
    favorites = edited;
  }
  const initialModelPreferences = providerModelPreferences ?? current.providerModelPreferences;
  let nextModelPreferences = initialModelPreferences;
  if ((setModelsHidden?.length ?? 0) > 0 || setProviderModelOrder !== undefined) {
    const edited: Record<
      ProviderInstanceId,
      ModelPreferences["providerModelPreferences"][ProviderInstanceId]
    > = { ...initialModelPreferences };
    for (const change of setModelsHidden ?? []) {
      const preferences = (Object.hasOwn(edited, change.provider)
        ? edited[change.provider]
        : undefined) ?? { hiddenModels: [], modelOrder: [] };
      const hiddenModels = preferences.hiddenModels.filter((model) => model !== change.model);
      if (change.hidden) hiddenModels.push(change.model);
      edited[change.provider] = { ...preferences, hiddenModels };
    }
    if (setProviderModelOrder !== undefined) {
      const preferences = (Object.hasOwn(edited, setProviderModelOrder.provider)
        ? edited[setProviderModelOrder.provider]
        : undefined) ?? {
        hiddenModels: [],
        modelOrder: [],
      };
      edited[setProviderModelOrder.provider] = {
        ...preferences,
        modelOrder: [...setProviderModelOrder.modelOrder],
      };
    }
    nextModelPreferences = edited;
  }
  const next = deepMerge(current, patchForMerge);
  const nextWithReplacementsBase = {
    ...next,
    favorites,
    providerModelPreferences: nextModelPreferences,
    ...(worktreeCleanupPatch === undefined
      ? {}
      : {
          worktreeCleanup:
            worktreeCleanupPatch?.mode === "custom"
              ? {
                  mode: "custom" as const,
                  rules: {
                    worktreeKeepWhen: next.storageCleanup.worktreeKeepWhen,
                    worktreeAfterDays: next.storageCleanup.worktreeAfterDays,
                    worktreeDoneAfterDays: next.storageCleanup.worktreeDoneAfterDays,
                    worktreeOnMerge: next.storageCleanup.worktreeOnMerge,
                    worktreeOnDelete: next.storageCleanup.worktreeOnDelete,
                    worktreeUnchanged: next.storageCleanup.worktreeUnchanged,
                    ...(current.worktreeCleanup?.mode === "custom"
                      ? current.worktreeCleanup.rules
                      : {}),
                    ...worktreeCleanupPatch.rules,
                  },
                }
              : worktreeCleanupPatch,
        }),
    ...(backgroundActivity !== undefined
      ? {
          backgroundActivity: {
            ...deepMerge(currentBackgroundActivity, backgroundActivity),
            ...(backgroundActivity.overrides !== undefined
              ? { overrides: backgroundActivity.overrides }
              : {}),
          },
        }
      : { backgroundActivity: currentBackgroundActivity }),
    ...(backgroundActivity === undefined && backgroundActivityPatch !== undefined
      ? { backgroundActivity: backgroundActivityPatch }
      : {}),
    ...(patch.providerInstances !== undefined
      ? { providerInstances: patch.providerInstances }
      : {}),
    ...(patch.worktreesDirectory !== undefined &&
    patch.worktreesDirectory !== current.worktreesDirectory
      ? {
          previousWorktreesDirectories: [
            ...current.previousWorktreesDirectories.filter(
              (directory) => directory !== patch.worktreesDirectory,
            ),
            ...(current.worktreesDirectory !== "" &&
            !current.previousWorktreesDirectories.includes(current.worktreesDirectory)
              ? [current.worktreesDirectory]
              : []),
          ],
        }
      : {}),
    // Per host, a patched field replaces the saved one: deepMerge would keep a cleared account pin.
    ...(hostSettingsPatch !== undefined
      ? {
          sourceControlHosts: {
            ...current.sourceControlHosts,
            ...Object.fromEntries(
              Object.entries(hostSettingsPatch).map(([kind, fields]) => [
                kind,
                { ...current.sourceControlHosts[kind], ...fields },
              ]),
            ),
          },
        }
      : {}),
    ...(projectSettingsOverridesPatch !== undefined || projectSettingsOverrideRemovals !== undefined
      ? {
          projectSettingsOverrides: Object.fromEntries(
            Object.entries(
              mergeProjectSettingsOverridesPatch(
                current.projectSettingsOverrides,
                projectSettingsOverridesPatch ?? {},
                projectSettingsOverrideRemovals ?? {},
              ),
            ).filter(([, entry]) => Object.keys(entry).length > 0),
          ),
        }
      : {}),
    ...(patch.defaultModelSelection !== undefined
      ? { defaultModelSelection: patch.defaultModelSelection }
      : {}),
    ...(patch.fallbackModelSelection !== undefined
      ? { fallbackModelSelection: patch.fallbackModelSelection }
      : {}),
    ...(patch.defaultProjectScripts !== undefined
      ? { defaultProjectScripts: patch.defaultProjectScripts }
      : {}),
    ...(secretProvidersPatch !== undefined
      ? { secretProviders: mergeSettingsEntries(current.secretProviders, secretProvidersPatch) }
      : {}),
    ...(usagePriceOverridesPatch !== undefined
      ? {
          usagePriceOverrides: mergeSettingsEntries(
            current.usagePriceOverrides,
            usagePriceOverridesPatch,
          ),
        }
      : {}),
    ...(usageModelAliasesPatch !== undefined
      ? {
          usageModelAliases: mergeSettingsEntries(
            current.usageModelAliases,
            usageModelAliasesPatch,
          ),
        }
      : {}),
    ...(patch.sourceControlWriterModelSelection !== undefined
      ? { sourceControlWriterModelSelection: patch.sourceControlWriterModelSelection }
      : {}),
    ...(patch.reviewGuideModelSelection !== undefined
      ? { reviewGuideModelSelection: patch.reviewGuideModelSelection }
      : {}),
  };
  const normalizedBackgroundActivity = normalizeBackgroundActivitySettings(
    nextWithReplacementsBase.backgroundActivity,
  );
  const nextWithReplacements = {
    ...nextWithReplacementsBase,
    backgroundActivity: normalizedBackgroundActivity,
  };
  if (!selectionPatch) {
    return nextWithReplacements;
  }

  const instanceId = selectionPatch.instanceId ?? current.textGenerationModelSelection.instanceId;
  const model = selectionPatch.model ?? current.textGenerationModelSelection.model;
  const options = shouldReplaceTextGenerationModelSelection(selectionPatch)
    ? selectionPatch.options
    : mergeModelSelectionOptionsById({
        current: current.textGenerationModelSelection.options,
        patch: selectionPatch.options,
      });

  return {
    ...nextWithReplacements,
    textGenerationModelSelection: createModelSelection(instanceId, model, options),
  };
}
