import type {
  BackgroundActivityProfile,
  BackgroundActivitySettings,
  ProviderInstanceConfig,
  PreviewViewportSetting,
  ProviderInstanceId,
  ServerSettings,
  SidebarProjectGroupingMode,
  UnifiedSettings,
} from "@supaterm/contracts";
import {
  DEFAULT_UNIFIED_SETTINGS,
  MAX_SIDEBAR_AUTO_MARK_DONE_AFTER_DAYS,
  MIN_SIDEBAR_AUTO_MARK_DONE_AFTER_DAYS,
} from "@supaterm/contracts/settings";
import {
  getBackgroundActivityBaseProfile,
  normalizeBackgroundActivitySettings,
  normalizeServerBackgroundActivitySettings,
  resolveServerBackgroundActivitySettings,
} from "@supaterm/shared/backgroundActivitySettings";
import * as Duration from "effect/Duration";
import * as Equal from "effect/Equal";

export function isProjectGroupingEnabled(mode: SidebarProjectGroupingMode) {
  return mode !== "separate";
}

export function projectGroupingModeFromToggle(
  enabled: boolean,
  lastEnabledMode: SidebarProjectGroupingMode = "repository",
) {
  if (!enabled) return "separate";
  return lastEnabledMode === "repository_path" ? "repository_path" : "repository";
}

const LAST_ENABLED_PROJECT_GROUPING_MODE_KEY = "supaterm:last-enabled-project-grouping-mode";

export function readLastEnabledProjectGroupingMode() {
  try {
    return localStorage.getItem(LAST_ENABLED_PROJECT_GROUPING_MODE_KEY) === "repository_path"
      ? "repository_path"
      : "repository";
  } catch {
    return "repository";
  }
}

export function rememberEnabledProjectGroupingMode(mode: SidebarProjectGroupingMode) {
  if (mode === "separate") return;
  try {
    localStorage.setItem(LAST_ENABLED_PROJECT_GROUPING_MODE_KEY, mode);
  } catch {}
}

export function hasChangedBackgroundActivitySettings(
  settings: Pick<UnifiedSettings, "backgroundActivity">,
) {
  return !Equal.equals(settings.backgroundActivity, DEFAULT_UNIFIED_SETTINGS.backgroundActivity);
}

type TypographySettings = Pick<
  UnifiedSettings,
  | "fontFamilySans"
  | "fontFamilyComposer"
  | "fontFamilyCode"
  | "fontFamilyTerminal"
  | "fontSizeInterface"
  | "fontSizePrompt"
  | "fontSizeCode"
  | "fontSizeTerminal"
>;

export function getChangedTypographySettingLabels(settings: TypographySettings) {
  return [
    ...(settings.fontFamilySans !== DEFAULT_UNIFIED_SETTINGS.fontFamilySans ||
    settings.fontSizeInterface !== DEFAULT_UNIFIED_SETTINGS.fontSizeInterface
      ? ["Interface font"]
      : []),
    ...(settings.fontFamilyComposer !== DEFAULT_UNIFIED_SETTINGS.fontFamilyComposer ||
    settings.fontSizePrompt !== DEFAULT_UNIFIED_SETTINGS.fontSizePrompt
      ? ["Prompt font"]
      : []),
    ...(settings.fontFamilyCode !== DEFAULT_UNIFIED_SETTINGS.fontFamilyCode ||
    settings.fontSizeCode !== DEFAULT_UNIFIED_SETTINGS.fontSizeCode
      ? ["Code font"]
      : []),
    ...(settings.fontFamilyTerminal !== DEFAULT_UNIFIED_SETTINGS.fontFamilyTerminal ||
    settings.fontSizeTerminal !== DEFAULT_UNIFIED_SETTINGS.fontSizeTerminal
      ? ["Terminal font"]
      : []),
  ];
}

export type BrowserDefaultSettings = Pick<
  UnifiedSettings,
  | "browserDefaultViewport"
  | "browserDefaultZoomFactor"
  | "browserDefaultAppearance"
  | "browserRecordingFrameRate"
  | "browserRecordingShowKeyPresses"
  | "browserRecordingShowMousePresses"
  | "browserLinkTarget"
  | "browserSearchEngine"
  | "browserCustomSearchUrl"
  | "browserAgentOpenTarget"
  | "pullRequestLinksOpenInApp"
>;

function isSamePreviewViewport(left: PreviewViewportSetting, right: PreviewViewportSetting) {
  if (left._tag !== right._tag) return false;
  if (left._tag === "fill" || right._tag === "fill") return true;
  if (left.width !== right.width || left.height !== right.height) return false;
  return left._tag === "preset" && right._tag === "preset"
    ? left.presetId === right.presetId
    : true;
}

export function getChangedBrowserSettingLabels(settings: BrowserDefaultSettings) {
  return [
    ...(isSamePreviewViewport(
      settings.browserDefaultViewport,
      DEFAULT_UNIFIED_SETTINGS.browserDefaultViewport,
    )
      ? []
      : ["Browser viewport"]),
    ...(settings.browserDefaultZoomFactor !== DEFAULT_UNIFIED_SETTINGS.browserDefaultZoomFactor
      ? ["Browser zoom"]
      : []),
    ...(settings.browserDefaultAppearance !== DEFAULT_UNIFIED_SETTINGS.browserDefaultAppearance
      ? ["Browser appearance"]
      : []),
    ...(settings.browserRecordingFrameRate !== DEFAULT_UNIFIED_SETTINGS.browserRecordingFrameRate
      ? ["Recording frame rate"]
      : []),
    ...(settings.browserRecordingShowKeyPresses ? ["Recording key presses"] : []),
    ...(settings.browserRecordingShowMousePresses ? ["Recording mouse presses"] : []),
    ...(settings.browserLinkTarget !== DEFAULT_UNIFIED_SETTINGS.browserLinkTarget
      ? ["Open links in"]
      : []),
    ...(settings.browserSearchEngine !== DEFAULT_UNIFIED_SETTINGS.browserSearchEngine ||
    settings.browserCustomSearchUrl !== DEFAULT_UNIFIED_SETTINGS.browserCustomSearchUrl
      ? ["Search engine"]
      : []),
    ...(settings.browserAgentOpenTarget !== DEFAULT_UNIFIED_SETTINGS.browserAgentOpenTarget
      ? ["Show agent browsers and devices in"]
      : []),
    ...(settings.pullRequestLinksOpenInApp !== DEFAULT_UNIFIED_SETTINGS.pullRequestLinksOpenInApp
      ? ["Open pull requests in Supaterm"]
      : []),
  ];
}

export function resolveBackgroundActivityProfileOption(settings: ServerSettings) {
  const resolved = resolveServerBackgroundActivitySettings(settings);
  const normalized = normalizeBackgroundActivitySettings({
    schemaVersion: 1,
    profile: "custom",
    baseProfile: resolved.profile,
    overrides: {
      automaticGitFetchInterval: resolved.automaticGitFetchInterval,
      providerHealthRefreshInterval: resolved.providerHealthRefreshInterval,
      hostPowerMonitorActiveInterval: resolved.hostPowerMonitorActiveInterval,
      hostPowerMonitorIdleInterval: resolved.hostPowerMonitorIdleInterval,
      pauseWhenHostLocked: resolved.pauseWhenHostLocked,
      pauseWhenHostLowPower: resolved.pauseWhenHostLowPower,
      pauseWhenClientLowPower: resolved.pauseWhenClientLowPower,
      pauseWhenOnBattery: resolved.pauseWhenOnBattery,
    },
  });
  return (normalized.profile === "custom" ? "advanced" : normalized.profile) satisfies
    | BackgroundActivityProfile
    | "advanced";
}

export function backgroundActivitySharedPolicySettings(
  settings: ServerSettings,
  profile: BackgroundActivityProfile,
) {
  const normalized = normalizeServerBackgroundActivitySettings(settings);
  return {
    schemaVersion: 1,
    profile: "custom",
    baseProfile: profile,
    overrides: normalized.profile === "custom" ? normalized.overrides : {},
  } satisfies BackgroundActivitySettings;
}

export function buildProviderInstanceUpdatePatch(input: {
  readonly settings: Pick<ServerSettings, "providerInstances">;
  readonly instanceId: ProviderInstanceId;
  readonly instance: ProviderInstanceConfig;
  readonly textGenerationModelSelection?:
    | ServerSettings["textGenerationModelSelection"]
    | undefined;
}) {
  return {
    providerInstances: {
      ...input.settings.providerInstances,
      [input.instanceId]: input.instance,
    },
    ...(input.textGenerationModelSelection !== undefined
      ? { textGenerationModelSelection: input.textGenerationModelSelection }
      : {}),
  };
}

export const PROVIDER_HEALTH_INTERVAL_STEP_SECONDS = 30;

type BackgroundActivityOverridePatch = Partial<{
  [K in keyof BackgroundActivitySettings["overrides"]]:
    | BackgroundActivitySettings["overrides"][K]
    | undefined;
}>;

export function durationToSeconds(duration: Duration.Duration) {
  return Math.round(Duration.toMillis(duration) / 1_000);
}

export function normalizeIntervalSeconds(value: number | null, minimum = 0) {
  if (value === null || !Number.isFinite(value)) {
    return minimum;
  }
  return Math.max(minimum, Math.round(value));
}

export function backgroundActivityOverrideSettings(
  current: BackgroundActivitySettings,
  resolved: ReturnType<typeof resolveServerBackgroundActivitySettings>,
  overrides: BackgroundActivityOverridePatch,
) {
  const nextOverrides: BackgroundActivityOverridePatch = {
    automaticGitFetchInterval: resolved.automaticGitFetchInterval,
    providerHealthRefreshInterval: resolved.providerHealthRefreshInterval,
    hostPowerMonitorActiveInterval: resolved.hostPowerMonitorActiveInterval,
    hostPowerMonitorIdleInterval: resolved.hostPowerMonitorIdleInterval,
    pauseWhenHostLocked: resolved.pauseWhenHostLocked,
    pauseWhenHostLowPower: resolved.pauseWhenHostLowPower,
    pauseWhenClientLowPower: resolved.pauseWhenClientLowPower,
    pauseWhenOnBattery: resolved.pauseWhenOnBattery,
    ...overrides,
  };
  for (const [key, value] of Object.entries(nextOverrides)) {
    if (value === undefined) {
      delete nextOverrides[key as keyof typeof nextOverrides];
    }
  }
  return {
    backgroundActivity: {
      schemaVersion: 1 as const,
      profile: "custom" as const,
      baseProfile: getBackgroundActivityBaseProfile(current),
      overrides: nextOverrides as BackgroundActivitySettings["overrides"],
    },
  };
}

/**
 * Saving a shorter age marks threads Done at once, so typing stays in `draft` until the edit is
 * finished. `pending` is the submission in flight; `saved` is the only value a draft falls back to.
 */
export interface AutoMarkDoneDaysField {
  readonly saved: number;
  readonly draft: string;
  readonly dirty: boolean;
  readonly pending: number | null;
  readonly revision: number;
}

export function autoMarkDoneDaysField(saved: number): AutoMarkDoneDaysField;
export function autoMarkDoneDaysField(saved: number) {
  return { saved, draft: String(saved), dirty: false, pending: null, revision: 0 };
}

export function syncAutoMarkDoneDaysField(
  field: AutoMarkDoneDaysField,
  saved: number,
): AutoMarkDoneDaysField;
export function syncAutoMarkDoneDaysField(field: AutoMarkDoneDaysField, saved: number) {
  const pending = field.pending === saved ? null : field.pending;
  if (field.saved === saved && pending === field.pending)
    return field satisfies AutoMarkDoneDaysField;
  return {
    ...field,
    saved,
    pending,
    draft: field.dirty ? field.draft : String(pending ?? saved),
  } satisfies AutoMarkDoneDaysField;
}

export function editAutoMarkDoneDaysField(
  field: AutoMarkDoneDaysField,
  draft: string,
): AutoMarkDoneDaysField;
export function editAutoMarkDoneDaysField(field: AutoMarkDoneDaysField, draft: string) {
  return { ...field, draft, dirty: true } satisfies AutoMarkDoneDaysField;
}

export function cancelAutoMarkDoneDaysField(field: AutoMarkDoneDaysField): AutoMarkDoneDaysField;
export function cancelAutoMarkDoneDaysField(field: AutoMarkDoneDaysField) {
  return {
    ...field,
    draft: String(field.pending ?? field.saved),
    dirty: false,
  } satisfies AutoMarkDoneDaysField;
}

export function commitAutoMarkDoneDaysField(field: AutoMarkDoneDaysField): {
  readonly field: AutoMarkDoneDaysField;
  readonly submit: number | null;
};
export function commitAutoMarkDoneDaysField(field: AutoMarkDoneDaysField) {
  const current = field.pending ?? field.saved;
  const days = field.draft.trim() === "" ? Number.NaN : Number(field.draft);
  if (
    !Number.isInteger(days) ||
    days < MIN_SIDEBAR_AUTO_MARK_DONE_AFTER_DAYS ||
    days > MAX_SIDEBAR_AUTO_MARK_DONE_AFTER_DAYS
  ) {
    return { field: { ...field, draft: String(current), dirty: false }, submit: null } satisfies {
      readonly field: AutoMarkDoneDaysField;
      readonly submit: number | null;
    };
  }
  const settled = { ...field, draft: String(days), dirty: false };
  if (!field.dirty || days === field.pending)
    return { field: settled, submit: null } satisfies {
      readonly field: AutoMarkDoneDaysField;
      readonly submit: number | null;
    };
  return {
    field: { ...settled, pending: days, revision: field.revision + 1 },
    submit: days,
  } satisfies {
    readonly field: AutoMarkDoneDaysField;
    readonly submit: number | null;
  };
}

export function failAutoMarkDoneDaysField(
  field: AutoMarkDoneDaysField,
  revision: number,
): AutoMarkDoneDaysField;
export function failAutoMarkDoneDaysField(field: AutoMarkDoneDaysField, revision: number) {
  if (field.revision !== revision) return field satisfies AutoMarkDoneDaysField;
  return {
    ...field,
    pending: null,
    draft: field.dirty ? field.draft : String(field.saved),
  } satisfies AutoMarkDoneDaysField;
}
