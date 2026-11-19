// @effect-diagnostics globalDate:off -- UI snooze presets use local calendar boundaries and Intl labels.
import * as DateTime from "effect/DateTime";
import { DEFAULT_SNOOZE_PRESETS, type SnoozePresetSetting } from "@supaterm/contracts/settings";

import type { EnvironmentThreadShell, PendingSubagentRequest } from "./models.ts";

interface SnoozeRunLike {
  readonly turnId?: unknown;
  readonly assistantMessageId?: unknown;
  readonly status?: string;
  readonly state?: string;
  readonly requestedAt?: string | null;
  readonly startedAt?: string | null;
  readonly completedAt?: string | null;
}

interface SnoozeRuntimeLike {
  readonly threadId?: unknown;
  readonly providerName?: unknown;
  readonly runtimeMode?: unknown;
  readonly activeTurnId?: unknown;
  readonly lastError?: unknown;
  readonly status: string;
  readonly updatedAt?: string;
}

interface QueuedThreadShell {
  readonly latestUserMessageAt?: string | null;
  readonly latestTurn?: SnoozeRunLike | null;
  readonly latestRun?: SnoozeRunLike | null;
  readonly session?: SnoozeRuntimeLike | null;
  readonly runtime?: SnoozeRuntimeLike | null;
}

/**
 * Session adoption takes seconds, so a user message still unadopted after this
 * is a failed start or stale data, not pending work. Without the bound such
 * threads could never be marked done.
 */
export const QUEUED_TURN_START_GRACE_MS = 2 * 60 * 1_000;

export function hasQueuedTurnStart(shell: QueuedThreadShell, options: { readonly now: string }) {
  if (
    shell.runtime?.status === "preparing" ||
    shell.runtime?.status === "queued" ||
    shell.runtime?.status === "starting"
  ) {
    return true;
  }
  if (shell.latestUserMessageAt == null) return false;
  if (shell.session?.status === "error") return false;
  const messageAt = Date.parse(shell.latestUserMessageAt);
  if (Number.isNaN(messageAt)) return false;
  const nowMs = Date.parse(options.now);
  if (Number.isNaN(nowMs)) return false;
  if (Math.abs(nowMs - messageAt) > QUEUED_TURN_START_GRACE_MS) return false;
  const turn = shell.latestRun ?? shell.latestTurn ?? null;
  if (turn === null) return true;
  return [turn.requestedAt, turn.startedAt, turn.completedAt].every(
    (candidate) => candidate == null || Date.parse(candidate) < messageAt,
  );
}

export interface ThreadSnoozeShell extends QueuedThreadShell {
  readonly source?: Pick<EnvironmentThreadShell["source"], "pendingRuntimeRequest">;
  readonly snoozedUntil?: string | null;
  readonly snoozedAt?: string | null;
  readonly hasPendingApprovals: boolean;
  readonly hasPendingUserInput: boolean;
  readonly pendingUserInputAt?: string | null;
  readonly pendingSubagentRequest?: PendingSubagentRequest | null;
}

function pendingQuestionAt(shell: ThreadSnoozeShell) {
  const request = shell.source?.pendingRuntimeRequest;
  return (
    shell.pendingUserInputAt ??
    (request?.kind === "user_input" ? DateTime.formatIso(request.createdAt) : null)
  );
}

export function threadRaisedHandWhileSnoozed(shell: ThreadSnoozeShell) {
  const request = shell.source?.pendingRuntimeRequest;
  if (shell.hasPendingApprovals || (request != null && request.kind !== "user_input")) return true;
  const questionAt = pendingQuestionAt(shell);
  if (
    (shell.hasPendingUserInput || request?.kind === "user_input") &&
    (shell.snoozedAt == null ||
      questionAt == null ||
      !(Date.parse(questionAt) <= Date.parse(shell.snoozedAt)))
  ) {
    return true;
  }
  if (shell.pendingSubagentRequest != null) return true;
  const failedAt = failureEdgeAt(shell);
  return (
    failedAt !== undefined &&
    (shell.snoozedAt == null ||
      (failedAt != null && Date.parse(failedAt) > Date.parse(shell.snoozedAt)))
  );
}

function failureEdgeAt(shell: ThreadSnoozeShell) {
  const runtime = shell.runtime ?? shell.session ?? null;
  if (runtime?.status !== "error" && runtime?.status !== "failed") return undefined;
  const latestRun = shell.latestRun ?? shell.latestTurn ?? null;
  if (latestRun?.status === "failed") {
    return latestRun.completedAt ?? null;
  }
  return runtime.updatedAt ?? null;
}

/**
 * Refused while the agent or a subagent waits on the user, since hiding the
 * request defeats it, or while a turn start is still queued. A running session
 * is snoozable: snooze only hides it. Client twin of the server invariants.
 */
export function canSnooze(
  shell: Pick<
    ThreadSnoozeShell,
    | "hasPendingApprovals"
    | "hasPendingUserInput"
    | "pendingSubagentRequest"
    | "latestUserMessageAt"
    | "latestTurn"
    | "latestRun"
    | "session"
    | "runtime"
    | "source"
  >,
  options: { readonly now: string },
) {
  if (shell.hasPendingApprovals) return false;
  const request = shell.source?.pendingRuntimeRequest;
  if (request != null && request.kind !== "user_input") return false;
  if (shell.pendingSubagentRequest != null) return false;
  if (hasQueuedTurnStart(shell, options)) return false;
  return true;
}

export function effectiveSnoozed(shell: ThreadSnoozeShell, options: { readonly now: string }) {
  if (shell.snoozedUntil == null) return false;
  const wakeAtMs = Date.parse(shell.snoozedUntil);
  if (Number.isNaN(wakeAtMs)) return false;
  if (wakeAtMs <= Date.parse(options.now)) return false;
  return !threadRaisedHandWhileSnoozed(shell);
}

export function threadWokeAt(shell: ThreadSnoozeShell, options: { readonly now: string }) {
  if (shell.snoozedUntil == null) return null;
  const wakeAtMs = Date.parse(shell.snoozedUntil);
  if (Number.isNaN(wakeAtMs)) return null;
  if (threadRaisedHandWhileSnoozed(shell)) {
    const failedAt = failureEdgeAt(shell);
    const questionAt = pendingQuestionAt(shell);
    const freshFailure =
      failedAt != null &&
      (shell.snoozedAt == null || Date.parse(failedAt) > Date.parse(shell.snoozedAt));
    const freshQuestion =
      questionAt != null &&
      shell.snoozedAt != null &&
      Date.parse(questionAt) > Date.parse(shell.snoozedAt);
    if (freshFailure && (!freshQuestion || Date.parse(failedAt) >= Date.parse(questionAt))) {
      return failedAt;
    }
    if (freshQuestion) return questionAt;
    const runtime = shell.runtime ?? shell.session ?? null;
    return runtime?.updatedAt ?? shell.snoozedAt ?? null;
  }
  return wakeAtMs <= Date.parse(options.now) ? shell.snoozedUntil : null;
}

const HOUR_MS = 60 * 60 * 1_000;

const WEEKDAY_INDEX = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
} as const;

export interface SnoozePreset {
  readonly id: string;
  readonly label: string;
  readonly whenLabel: string;
  readonly snoozedUntil: string;
}

export interface SnoozePresetOptions {
  readonly presets?: ReadonlyArray<SnoozePresetSetting>;
  readonly formatTime?: (date: Date) => string;
}

function snoozeTimeOfDayLabel(date: Date) {
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function addSnoozeDays(base: Date, days: number) {
  const next = DateTime.toDate(DateTime.makeUnsafe(base));
  next.setDate(next.getDate() + days);
  return next;
}

function pluralize(count: number, unit: string) {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

function formatSnoozeDuration(minutes: number) {
  if (minutes % (24 * 60) === 0) return pluralize(minutes / (24 * 60), "day");
  if (minutes % 60 === 0) return pluralize(minutes / 60, "hour");
  return pluralize(minutes, "minute");
}

function capitalize(word: string) {
  return word[0]!.toUpperCase() + word.slice(1);
}

function snoozePresetDaysAhead(setting: Extract<SnoozePresetSetting, { kind: "at" }>, now: Date) {
  if (setting.day === "today") return 0;
  if (setting.day === "tomorrow") return 1;
  return (WEEKDAY_INDEX[setting.day] - now.getDay() + 7) % 7 || 7;
}

function snoozePresetLabel(setting: SnoozePresetSetting, daysAhead: number) {
  if (setting.kind === "after") return `In ${formatSnoozeDuration(setting.minutes)}`;
  if (daysAhead === 0) {
    const hour = Number(setting.time.slice(0, 2));
    return hour < 12 ? "This morning" : hour < 17 ? "This afternoon" : "This evening";
  }
  if (daysAhead === 1) return "Tomorrow";
  if (setting.day === "monday") return "Next week";
  return daysAhead === 7 ? `Next ${capitalize(setting.day)}` : capitalize(setting.day);
}

export function snoozePresetId(setting: SnoozePresetSetting) {
  return setting.kind === "after"
    ? `after:${setting.minutes}`
    : `at:${setting.day}:${setting.time}`;
}

export function resolveSnoozePreset(
  setting: SnoozePresetSetting,
  now: Date,
  formatTime: (date: Date) => string = snoozeTimeOfDayLabel,
) {
  let wake: Date;
  let daysAhead = 0;
  if (setting.kind === "after") {
    wake = DateTime.toDate(DateTime.makeUnsafe(now.getTime() + setting.minutes * 60_000));
  } else {
    daysAhead = snoozePresetDaysAhead(setting, now);
    wake = addSnoozeDays(now, daysAhead);
    wake.setHours(Number(setting.time.slice(0, 2)), Number(setting.time.slice(3)), 0, 0);
    if (wake.getTime() <= now.getTime()) return null;
  }
  const label = snoozePresetLabel(setting, daysAhead);
  const labelNamesDay = setting.kind === "at" && label !== "Next week";
  const time = formatTime(wake);
  return {
    id: snoozePresetId(setting),
    label,
    whenLabel:
      labelNamesDay || wake.toDateString() === now.toDateString()
        ? time
        : `${wake.toLocaleDateString(undefined, { weekday: "short" })} ${time}`,
    snoozedUntil: wake.toISOString(),
  };
}

/** The snooze menu: soonest first, one row per wake minute. */
export function resolveSnoozePresets(now: Date, options: SnoozePresetOptions = {}) {
  const wakeMinute = (preset: SnoozePreset) => Math.floor(Date.parse(preset.snoozedUntil) / 60_000);
  const seen = new Set<number>();
  return (options.presets ?? DEFAULT_SNOOZE_PRESETS)
    .flatMap((setting) => resolveSnoozePreset(setting, now, options.formatTime) ?? [])
    .sort((a, b) => wakeMinute(a) - wakeMinute(b))
    .filter((preset) => {
      if (seen.has(wakeMinute(preset))) return false;
      seen.add(wakeMinute(preset));
      return true;
    });
}

/**
 * A menu choice as picked. A duration re-resolves from its setting (not the deduped menu) so it
 * starts at selection. A set time keeps the shown wake, which a day change would otherwise shift.
 */
export function pickSnoozePreset(input: {
  readonly shown: ReadonlyArray<SnoozePreset>;
  readonly id: string;
  readonly now: Date;
  readonly presets?: ReadonlyArray<SnoozePresetSetting>;
  readonly formatTime?: (date: Date) => string;
}) {
  const original = input.shown.find((preset) => preset.id === input.id);
  const ahead =
    original && Date.parse(original.snoozedUntil) > input.now.getTime() ? original : undefined;
  const setting = (input.presets ?? DEFAULT_SNOOZE_PRESETS).find(
    (candidate) => candidate.kind === "after" && snoozePresetId(candidate) === input.id,
  );
  return (setting && resolveSnoozePreset(setting, input.now, input.formatTime)) ?? ahead;
}

export function snoozeWakeLabel(snoozedUntil: string, options: { readonly now: string }) {
  const wakeMs = Date.parse(snoozedUntil);
  const nowMs = Date.parse(options.now);
  if (Number.isNaN(wakeMs) || Number.isNaN(nowMs)) return "now";
  if (wakeMs <= nowMs) return "now";
  const minutes = Math.max(1, Math.floor(wakeMs / 60_000) - Math.floor(nowMs / 60_000));
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 24 * 60) return `${Math.ceil(minutes / 60)}h`;
  return `${Math.ceil(minutes / (24 * 60))}d`;
}

export type CustomSnoozeInput =
  | { readonly mode: "date"; readonly date: string; readonly time: string }
  | {
      readonly mode: "duration";
      readonly amount: string;
      readonly unit: "minutes" | "hours" | "days";
    };

export function resolveCustomSnooze(input: CustomSnoozeInput, now: Date) {
  let wake: Date;
  if (input.mode === "duration") {
    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    const unitMs = { minutes: 60_000, hours: HOUR_MS, days: 24 * HOUR_MS }[input.unit];
    wake = new Date(now.getTime() + amount * unitMs);
  } else {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !/^\d{2}:\d{2}$/.test(input.time)) return null;
    wake = new Date(`${input.date}T${input.time}:00`);
    if (localSnoozeDate(wake) !== input.date || localSnoozeTime(wake) !== input.time) return null;
  }
  return Number.isFinite(wake.getTime()) && wake.getTime() > now.getTime()
    ? wake.toISOString()
    : null;
}

export function localSnoozeDate(date: Date) {
  return `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function localSnoozeTime(date: Date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/**
 * Whether a woken thread woke after the user last saw it. A run that completed
 * after the last visit counts as seeing it, since the user watched it finish.
 */
export function isThreadWokeUnseen(input: {
  readonly wokeAt: string | null;
  readonly done: boolean;
  readonly lastVisitedAt: string | null | undefined;
  readonly latestRunCompletedAt: string | null;
}) {
  if (input.wokeAt === null || input.done) return false;
  const wokeAtMs = Date.parse(input.wokeAt);
  if (Number.isNaN(wokeAtMs)) return false;
  const seenSinceWake = (at: string | null | undefined) =>
    at ? Date.parse(at) >= wokeAtMs : false;
  return !seenSinceWake(input.lastVisitedAt) && !seenSinceWake(input.latestRunCompletedAt);
}

/**
 * Whether the latest run failed after the user last saw the thread. Only the run dates the
 * failure, since the shell's updatedAt also moves on renames. A failed run without a
 * completion time, from older data, is dated by its start.
 */
export function hasUnseenRunFailure(
  thread: Pick<EnvironmentThreadShell, "latestRun"> & {
    readonly lastVisitedAt?: string | null | undefined;
  },
) {
  const run = thread.latestRun;
  if (run?.status !== "failed") return false;
  if (!thread.lastVisitedAt) return true;
  const failedAtMs = Date.parse(run.completedAt ?? run.startedAt ?? run.requestedAt ?? "");
  const lastVisitedAtMs = Date.parse(thread.lastVisitedAt);
  if (Number.isNaN(failedAtMs) || Number.isNaN(lastVisitedAtMs)) return true;
  return failedAtMs > lastVisitedAtMs;
}
