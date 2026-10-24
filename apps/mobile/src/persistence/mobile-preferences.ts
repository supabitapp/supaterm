import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import {
  EnvironmentId,
  SidebarThreadGrouping,
  PullRequestInvolvement,
  PullRequestListFilters,
  PullRequestListState,
  type PullRequestMergeMethod,
  type SidebarProjectGroupingMode,
} from "@supaterm/contracts";
import { DictationRouting } from "@supaterm/client-runtime/state/dictation";
import type { ComposerEnterBehavior } from "../lib/composerEnterBehavior";
import type { FollowUpBehavior } from "../lib/followUpBehavior";
import { isMicrophoneKind, type MicrophoneEntry } from "../lib/microphonePriority";
import { MOBILE_THEME_IDS, type MobileThemeId, type MobileThemeMode } from "../lib/mobileTheme";
import * as MobileDatabase from "./mobile-database";
import * as MobileSecureStorage from "./mobile-secure-storage";
import { MobileStorageDecodeError, MobileStorageEncodeError } from "./mobile-storage";

const PREFERENCES_KEY = "supaterm.preferences";
const PREFERENCES_FALLBACK_KEY = "supaterm.preferences.fallback";

export const PullRequestListControls = Schema.Struct({
  state: PullRequestListState,
  involvement: PullRequestInvolvement,
  filters: PullRequestListFilters,
  projectId: Schema.optional(Schema.String),
  projectEnvironmentId: Schema.optional(Schema.String),
  sort: Schema.Literals(["updated", "created", "oldest"]),
});
export type PullRequestListControls = typeof PullRequestListControls.Type;

const ThreadListFilters = Schema.Struct({
  environmentId: Schema.NullOr(EnvironmentId),
  projectKey: Schema.NullOr(Schema.String),
});
export type ThreadListFilters = typeof ThreadListFilters.Type;

const PullRequestListPreferences = Schema.Struct({
  environmentId: Schema.NullOr(Schema.String),
  controls: Schema.Record(Schema.String, PullRequestListControls),
});
export type PullRequestListPreferences = typeof PullRequestListPreferences.Type;

const isThreadGrouping = Schema.is(SidebarThreadGrouping);
const isThreadListFilters = Schema.is(ThreadListFilters);
const isPullRequestListPreferences = Schema.is(PullRequestListPreferences);
const isDictationRouting = Schema.is(DictationRouting);

export interface Preferences {
  readonly pullRequestHideTestFiles?: boolean;
  readonly pullRequestMergeMethod?: PullRequestMergeMethod;
  readonly lightThemeId?: MobileThemeId;
  readonly darkThemeId?: MobileThemeId;
  readonly themeMode?: MobileThemeMode;
  readonly baseFontSize?: number;
  readonly terminalFontSize?: number | null;
  readonly codeFontSize?: number | null;
  readonly codeWordBreak?: boolean;
  readonly mathRenderingEnabled?: boolean;
  readonly collapsedProjectGroups?: readonly string[];
  /** Environments whose "reclaim database space" notice was dismissed. */
  readonly dismissedDatabaseStorageNotices?: readonly string[];
  /** What the Return key does in the composer on a hardware keyboard. iOS only. */
  readonly composerEnterBehavior?: ComposerEnterBehavior;
  readonly showSkillsInSlashMenu?: boolean;
  readonly showToolImages?: boolean;
  readonly followUpBehavior?: FollowUpBehavior;
  readonly microphones?: ReadonlyArray<MicrophoneEntry>;
  /** Which environment transcribes voice input from this device. */
  readonly dictationRouting?: DictationRouting;
  /** Transcribe with Apple's on-device speech model instead of an environment. iOS only. */
  readonly transcribeOnDevice?: boolean;
  readonly projectGroupingMode?: SidebarProjectGroupingMode;
  readonly threadGrouping?: SidebarThreadGrouping;
  readonly threadListPinnedShelfExpanded?: boolean;
  readonly threadListActiveShelfExpanded?: boolean;
  readonly threadListDoneShelfExpanded?: boolean;
  readonly threadListSnoozedShelfExpanded?: boolean;
  readonly threadListWorkingShelfExpanded?: boolean;
  readonly threadListCollapsedGroups?: readonly string[];
  readonly threadListFilters?: ThreadListFilters;
  readonly pullRequestListFilters?: PullRequestListPreferences;
}

export class MobilePreferencesLoadError extends Schema.TaggedError<MobilePreferencesLoadError>()(
  "MobilePreferencesLoadError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Failed to load mobile preferences.";
  }
}

export class MobilePreferencesSaveError extends Schema.TaggedError<MobilePreferencesSaveError>()(
  "MobilePreferencesSaveError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Failed to save mobile preferences.";
  }
}

interface PreferencesFallback {
  readonly payload: string;
  readonly updatedAt: number;
  readonly preferences: Preferences;
}

export class MobilePreferencesStore extends Context.Service<
  MobilePreferencesStore,
  {
    readonly load: Effect.Effect<Preferences, MobilePreferencesLoadError>;
    readonly savePatch: (
      patch: Partial<Preferences>,
    ) => Effect.Effect<Preferences, MobilePreferencesSaveError>;
    readonly update: (
      transform: (current: Preferences) => Partial<Preferences>,
    ) => Effect.Effect<Preferences, MobilePreferencesSaveError>;
  }
>()("@supaterm/mobile/persistence/MobilePreferencesStore") {}

function sanitizePreferences(parsed: Preferences): Preferences {
  const preferences: {
    pullRequestHideTestFiles?: boolean;
    pullRequestMergeMethod?: PullRequestMergeMethod;
    lightThemeId?: MobileThemeId;
    darkThemeId?: MobileThemeId;
    themeMode?: MobileThemeMode;
    baseFontSize?: number;
    terminalFontSize?: number | null;
    codeFontSize?: number | null;
    codeWordBreak?: boolean;
    mathRenderingEnabled?: boolean;
    collapsedProjectGroups?: readonly string[];
    dismissedDatabaseStorageNotices?: readonly string[];
    composerEnterBehavior?: ComposerEnterBehavior;
    showSkillsInSlashMenu?: boolean;
    showToolImages?: boolean;
    followUpBehavior?: FollowUpBehavior;
    microphones?: ReadonlyArray<MicrophoneEntry>;
    dictationRouting?: DictationRouting;
    transcribeOnDevice?: boolean;
    projectGroupingMode?: SidebarProjectGroupingMode;
    threadGrouping?: SidebarThreadGrouping;
    threadListPinnedShelfExpanded?: boolean;
    threadListActiveShelfExpanded?: boolean;
    threadListDoneShelfExpanded?: boolean;
    threadListSnoozedShelfExpanded?: boolean;
    threadListWorkingShelfExpanded?: boolean;
    threadListCollapsedGroups?: readonly string[];
    threadListFilters?: ThreadListFilters;
    pullRequestListFilters?: PullRequestListPreferences;
  } = {};

  if (typeof parsed.pullRequestHideTestFiles === "boolean") {
    preferences.pullRequestHideTestFiles = parsed.pullRequestHideTestFiles;
  }

  if (
    parsed.pullRequestMergeMethod === "squash" ||
    parsed.pullRequestMergeMethod === "merge" ||
    parsed.pullRequestMergeMethod === "rebase"
  ) {
    preferences.pullRequestMergeMethod = parsed.pullRequestMergeMethod;
  }

  if (
    typeof parsed.lightThemeId === "string" &&
    (MOBILE_THEME_IDS as readonly string[]).includes(parsed.lightThemeId)
  ) {
    preferences.lightThemeId = parsed.lightThemeId as MobileThemeId;
  }
  if (
    typeof parsed.darkThemeId === "string" &&
    (MOBILE_THEME_IDS as readonly string[]).includes(parsed.darkThemeId)
  ) {
    preferences.darkThemeId = parsed.darkThemeId as MobileThemeId;
  }
  if (
    parsed.themeMode === "system" ||
    parsed.themeMode === "light" ||
    parsed.themeMode === "dark"
  ) {
    preferences.themeMode = parsed.themeMode;
  }
  if (typeof parsed.baseFontSize === "number") preferences.baseFontSize = parsed.baseFontSize;
  if (typeof parsed.terminalFontSize === "number" || parsed.terminalFontSize === null) {
    preferences.terminalFontSize = parsed.terminalFontSize;
  }
  if (typeof parsed.codeFontSize === "number" || parsed.codeFontSize === null) {
    preferences.codeFontSize = parsed.codeFontSize;
  }
  if (typeof parsed.codeWordBreak === "boolean") preferences.codeWordBreak = parsed.codeWordBreak;
  if (typeof parsed.mathRenderingEnabled === "boolean")
    preferences.mathRenderingEnabled = parsed.mathRenderingEnabled;
  if (Array.isArray(parsed.collapsedProjectGroups)) {
    preferences.collapsedProjectGroups = parsed.collapsedProjectGroups.filter(
      (key): key is string => typeof key === "string",
    );
  }
  if (Array.isArray(parsed.dismissedDatabaseStorageNotices)) {
    preferences.dismissedDatabaseStorageNotices = parsed.dismissedDatabaseStorageNotices.filter(
      (value): value is string => typeof value === "string",
    );
  }
  if (parsed.composerEnterBehavior === "send" || parsed.composerEnterBehavior === "newline") {
    preferences.composerEnterBehavior = parsed.composerEnterBehavior;
  }
  if (typeof parsed.showSkillsInSlashMenu === "boolean") {
    preferences.showSkillsInSlashMenu = parsed.showSkillsInSlashMenu;
  }
  if (typeof parsed.showToolImages === "boolean") {
    preferences.showToolImages = parsed.showToolImages;
  }
  if (parsed.followUpBehavior === "queue" || parsed.followUpBehavior === "steer") {
    preferences.followUpBehavior = parsed.followUpBehavior;
  }
  if (Array.isArray(parsed.microphones)) {
    preferences.microphones = parsed.microphones.flatMap((entry): MicrophoneEntry[] => {
      if (typeof entry !== "object" || entry === null || !isMicrophoneKind(entry.kind)) return [];
      if (!("uid" in entry)) return [{ kind: entry.kind }];
      return typeof entry.uid === "string" && typeof entry.name === "string"
        ? [{ kind: entry.kind, uid: entry.uid, name: entry.name }]
        : [];
    });
  }
  if (isDictationRouting(parsed.dictationRouting)) {
    preferences.dictationRouting = parsed.dictationRouting;
  }
  if (typeof parsed.transcribeOnDevice === "boolean") {
    preferences.transcribeOnDevice = parsed.transcribeOnDevice;
  }
  if (
    parsed.projectGroupingMode === "repository" ||
    parsed.projectGroupingMode === "repository_path" ||
    parsed.projectGroupingMode === "separate"
  ) {
    preferences.projectGroupingMode = parsed.projectGroupingMode;
  }
  if (isThreadGrouping(parsed.threadGrouping)) {
    preferences.threadGrouping = parsed.threadGrouping;
  }
  if (typeof parsed.threadListPinnedShelfExpanded === "boolean") {
    preferences.threadListPinnedShelfExpanded = parsed.threadListPinnedShelfExpanded;
  }
  if (typeof parsed.threadListActiveShelfExpanded === "boolean") {
    preferences.threadListActiveShelfExpanded = parsed.threadListActiveShelfExpanded;
  }
  if (typeof parsed.threadListDoneShelfExpanded === "boolean") {
    preferences.threadListDoneShelfExpanded = parsed.threadListDoneShelfExpanded;
  }
  if (typeof parsed.threadListSnoozedShelfExpanded === "boolean") {
    preferences.threadListSnoozedShelfExpanded = parsed.threadListSnoozedShelfExpanded;
  }
  if (typeof parsed.threadListWorkingShelfExpanded === "boolean") {
    preferences.threadListWorkingShelfExpanded = parsed.threadListWorkingShelfExpanded;
  }
  if (Array.isArray(parsed.threadListCollapsedGroups)) {
    preferences.threadListCollapsedGroups = parsed.threadListCollapsedGroups.filter(
      (key): key is string => typeof key === "string",
    );
  }
  if (isThreadListFilters(parsed.threadListFilters)) {
    preferences.threadListFilters = parsed.threadListFilters;
  }
  if (isPullRequestListPreferences(parsed.pullRequestListFilters)) {
    preferences.pullRequestListFilters = parsed.pullRequestListFilters;
  }
  return preferences;
}

export const make = Effect.fn("MobilePreferencesStore.make")(function* () {
  const database = yield* MobileDatabase.MobileDatabase;
  const secureStorage = yield* MobileSecureStorage.MobileSecureStorage;
  const lock = yield* Semaphore.make(1);
  const lastUpdatedAt = yield* Ref.make(0);

  const parsePayload = (raw: string | null): Preferences | null => {
    if (raw === null || !raw.trim()) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (cause) {
      console.warn(
        "[mobile-storage] ignored invalid JSON",
        new MobileStorageDecodeError({ key: PREFERENCES_KEY, cause }),
      );
      return null;
    }
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Preferences)
      : null;
  };

  const parseFallback = (raw: string | null): PreferencesFallback | null => {
    if (raw === null || !raw.trim()) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (cause) {
      console.warn(
        "[mobile-storage] ignored invalid JSON",
        new MobileStorageDecodeError({ key: PREFERENCES_FALLBACK_KEY, cause }),
      );
      return null;
    }
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("payload" in parsed) ||
      typeof parsed.payload !== "string" ||
      !("updatedAt" in parsed) ||
      typeof parsed.updatedAt !== "number"
    ) {
      return null;
    }
    const preferences = parsePayload(parsed.payload);
    return preferences === null
      ? null
      : { payload: parsed.payload, updatedAt: parsed.updatedAt, preferences };
  };

  const encode = Effect.fn("MobilePreferencesStore.encode")(function* (
    key: string,
    value: unknown,
  ) {
    return yield* Effect.try({
      try: () => JSON.stringify(value),
      catch: (cause) => new MobileStorageEncodeError({ key, cause }),
    });
  });

  const nextUpdatedAt = Ref.modify(lastUpdatedAt, (last) => {
    const next = Math.max(Date.now(), last + 1);
    return [next, next] as const;
  });

  const saveJson = Effect.fn("MobilePreferencesStore.saveJson")(function* (
    payload: string,
    updatedAt?: number,
  ) {
    const timestamp = updatedAt ?? (yield* nextUpdatedAt);
    yield* Ref.update(lastUpdatedAt, (last) => Math.max(last, timestamp));
    const databaseResult = yield* Effect.result(database.savePreferencesJson(payload, timestamp));
    if (databaseResult._tag === "Failure") {
      yield* Effect.logWarning("Database unavailable; saving preferences to secure storage.").pipe(
        Effect.annotateLogs({ cause: databaseResult.failure }),
      );
      const fallback = yield* encode(PREFERENCES_FALLBACK_KEY, { payload, updatedAt: timestamp });
      yield* secureStorage.setItem(PREFERENCES_FALLBACK_KEY, fallback);
      return;
    }
    yield* secureStorage
      .removeItem(PREFERENCES_FALLBACK_KEY)
      .pipe(
        Effect.catch((error) =>
          Effect.logWarning("Could not remove the mobile preferences fallback.").pipe(
            Effect.annotateLogs({ error }),
          ),
        ),
      );
  });

  const loadUnlocked = Effect.gen(function* () {
    const databaseResult = yield* Effect.result(database.loadPreferencesJson);
    const databaseAvailable = databaseResult._tag === "Success";
    const storedJson = databaseAvailable
      ? databaseResult.success
      : Option.none<MobileDatabase.StoredPreferencesJson>();
    if (databaseResult._tag === "Failure") {
      yield* Effect.logWarning("Database unavailable; loading fallback preferences.").pipe(
        Effect.annotateLogs({ cause: databaseResult.failure }),
      );
    }

    const fallbackResult = yield* Effect.result(secureStorage.getItem(PREFERENCES_FALLBACK_KEY));
    let fallbackJson: string | null = null;
    if (fallbackResult._tag === "Success") {
      fallbackJson = fallbackResult.success;
    } else if (Option.isNone(storedJson)) {
      return yield* fallbackResult.failure;
    } else {
      yield* Effect.logWarning("Could not inspect the mobile preferences fallback.").pipe(
        Effect.annotateLogs({ error: fallbackResult.failure }),
      );
    }

    const fallback = parseFallback(fallbackJson);
    const storedPreferences = Option.isSome(storedJson)
      ? parsePayload(storedJson.value.payload)
      : null;
    const fallbackIsNewer =
      fallback !== null &&
      (storedPreferences === null ||
        (Option.isSome(storedJson) && fallback.updatedAt > storedJson.value.updatedAt));

    let parsed: Preferences | null = null;
    if (fallbackIsNewer) {
      parsed = fallback.preferences;
      yield* Ref.update(lastUpdatedAt, (last) => Math.max(last, fallback.updatedAt));
      if (databaseAvailable) yield* saveJson(fallback.payload, fallback.updatedAt);
    } else if (storedPreferences !== null && Option.isSome(storedJson)) {
      parsed = storedPreferences;
      yield* Ref.update(lastUpdatedAt, (last) => Math.max(last, storedJson.value.updatedAt));
      if (fallbackJson !== null) {
        yield* secureStorage
          .removeItem(PREFERENCES_FALLBACK_KEY)
          .pipe(
            Effect.catch((error) =>
              Effect.logWarning("Could not remove a stale mobile preferences fallback.").pipe(
                Effect.annotateLogs({ error }),
              ),
            ),
          );
      }
    }

    return parsed === null ? {} : sanitizePreferences(parsed);
  });

  const load = lock
    .withPermits(1)(loadUnlocked)
    .pipe(Effect.mapError((cause) => new MobilePreferencesLoadError({ cause })));

  const update = Effect.fn("MobilePreferencesStore.update")((transform) =>
    lock
      .withPermits(1)(
        Effect.gen(function* () {
          const current = yield* loadUnlocked;
          const patch = yield* Effect.try({
            try: () => transform(current),
            catch: (cause) => new MobilePreferencesSaveError({ cause }),
          });
          const next: Preferences = { ...current, ...patch };
          const payload = yield* encode(PREFERENCES_KEY, next);
          yield* saveJson(payload);
          return next;
        }),
      )
      .pipe(
        Effect.mapError((cause) =>
          cause instanceof MobilePreferencesSaveError
            ? cause
            : new MobilePreferencesSaveError({ cause }),
        ),
      ),
  );

  return MobilePreferencesStore.of({
    load,
    update,
    savePatch: (patch) => update(() => patch),
  });
});

export const layer = Layer.effect(MobilePreferencesStore, make());
