import {
  EnvironmentId,
  isListedThreadLineage,
  type ProjectId,
  ScheduledTaskId,
  type ScheduledTask,
  type ScheduledTaskSchedule,
  type ScheduledTaskThreadMode,
  scheduledTaskThreadMode,
  type ModelSelection,
  type RuntimeMode,
  type ProviderInteractionMode,
  type ServerSettings,
  type ThreadId,
} from "@supaterm/contracts";
import type { EnvironmentThreadShell } from "@supaterm/client-runtime/state/models";
import { scheduleTimeZoneLabel } from "@supaterm/client-runtime/scheduled-task-time-zone";
import type { TimestampFormat } from "@supaterm/contracts/settings";
import { msg } from "gt-react";

import {
  resolveProjectSettings,
  type LegacyProjectSettingsFields,
} from "@supaterm/shared/projectSettings";
import { m, type MessageResolver } from "../../i18n/messages";
import type { ProviderInstanceEntry } from "../../providerInstances";
import {
  formatDateTimeTimestamp,
  formatRelativeTimeLabel,
  formatTimeOfDay,
} from "../../timestampFormat";
import {
  validateSettingsScopeSearch,
  type ResolvedSettingsScope,
  type SettingsScopeSearch,
} from "../settings/settingsScope";

/**
 * Project IDs are local to an environment, so a project scope matches a task
 * only on the environment of one of its checkouts. It matches every project
 * record of the group, including stale duplicates at a checkout's path that a
 * task may still point at. Unscoped pages keep tasks whose project was removed.
 */
export function matchesAutomationScope(
  scope: ResolvedSettingsScope,
  environmentId: EnvironmentId,
  projectId: ProjectId,
): boolean {
  if (scope.kind === "unavailable" || !scope.environmentIds.includes(environmentId)) return false;
  if (scope.kind === "project") {
    return scope.group.memberProjectRefs.some(
      (ref) => ref.environmentId === environmentId && ref.projectId === projectId,
    );
  }
  if (scope.kind === "checkout") {
    return scope.checkout.environmentId === environmentId && scope.checkout.id === projectId;
  }
  return true;
}

/**
 * `project` (a sidebar project key) and `machine` (an environment ID) are the
 * page's scope, named like the settings scope. `environmentId` and `taskId`
 * are a one-shot deep link that opens the editor; the page drops them once the
 * editor closes so Back never reopens it.
 */
export interface AutomationsSearch {
  readonly project?: string;
  readonly machine?: string;
  readonly environmentId?: EnvironmentId;
  readonly taskId?: ScheduledTaskId;
}

export function validateAutomationsSearch(raw: Record<string, unknown>): AutomationsSearch {
  return {
    ...automationsScopeSearch(validateSettingsScopeSearch(raw)),
    ...(typeof raw.environmentId === "string" && raw.environmentId.trim()
      ? { environmentId: EnvironmentId.make(raw.environmentId) }
      : {}),
    ...(typeof raw.taskId === "string" && raw.taskId.trim()
      ? { taskId: ScheduledTaskId.make(raw.taskId) }
      : {}),
  };
}

/** The page's scope, without a task link. */
export function automationsScopeSearch(search: SettingsScopeSearch): AutomationsSearch {
  return {
    ...(search.project === undefined ? {} : { project: search.project }),
    ...(search.machine === undefined ? {} : { machine: search.machine }),
  };
}

export const WEEKDAY_LABELS = [
  msg("Sun", { $context: "abbreviated weekday name" }),
  msg("Mon", { $context: "abbreviated weekday name" }),
  msg("Tue", { $context: "abbreviated weekday name" }),
  msg("Wed", { $context: "abbreviated weekday name" }),
  msg("Thu", { $context: "abbreviated weekday name" }),
  msg("Fri", { $context: "abbreviated weekday name" }),
  msg("Sat", { $context: "abbreviated weekday name" }),
] as const;

/**
 * Fixed times run on the environment's clock, which may not be this device's. An older
 * server sends no zone, so the label says the time is the environment's instead.
 */
export function scheduleLabel(
  schedule: ScheduledTaskSchedule,
  timestampFormat: TimestampFormat,
  timeZone?: string,
  runAt?: string | null,
  resolve: MessageResolver = m,
): string {
  const summary = scheduleSummary(schedule, timestampFormat, timeZone, runAt, resolve);
  return schedule.type === "fixed_time" && scheduleTimeZoneLabel(timeZone, runAt) === undefined
    ? resolve(msg("{summary} (environment time)", { summary }))
    : summary;
}

export function scheduleSummary(
  schedule: ScheduledTaskSchedule,
  timestampFormat: TimestampFormat,
  timeZone?: string,
  runAt?: string | null,
  resolve: MessageResolver = m,
): string {
  if (schedule.type === "once")
    return resolve(
      msg("Once, {date}", { date: formatDateTimeTimestamp(schedule.runAt, timestampFormat) }),
    );
  if (schedule.type === "interval") {
    const minutes = schedule.everyMs / 60_000;
    if (!Number.isInteger(minutes))
      return resolve(msg("Every {count} sec", { count: Math.round(schedule.everyMs / 1000) }));
    if (minutes % 1440 === 0)
      return minutes === 1440
        ? resolve(msg("Every day"))
        : resolve(
            msg("{count, plural, one {Every {count} day} other {Every {count} days}}", {
              count: minutes / 1440,
            }),
          );
    if (minutes % 60 === 0)
      return minutes === 60
        ? resolve(msg("Every hour"))
        : resolve(
            msg("{count, plural, one {Every {count} hour} other {Every {count} hours}}", {
              count: minutes / 60,
            }),
          );
    return resolve(msg("Every {count} min", { count: minutes }));
  }
  const weekdays = schedule.weekdays ?? [];
  const days =
    weekdays.length === 0
      ? resolve(msg("Daily"))
      : weekdays.length === 5 && weekdays.every((day) => day >= 1 && day <= 5)
        ? resolve(msg("Weekdays"))
        : weekdays.map((day) => resolve(WEEKDAY_LABELS[day])).join(", ");
  const zone = scheduleTimeZoneLabel(timeZone, runAt);
  const time = formatTimeOfDay(schedule.timeOfDay, timestampFormat);
  return resolve(
    msg("{days} at {time}{zone}", { days, time, zone: zone === undefined ? "" : ` ${zone}` }),
  );
}

/** "in 5m" for upcoming instants, "5m ago" for past ones. */
export function relativeLabel(value: string, now: number, resolve: MessageResolver = m): string {
  const diffMs = Date.parse(value) - now;
  if (!(diffMs > 0)) return formatRelativeTimeLabel(value, now);
  const minutes = Math.ceil(diffMs / 60_000);
  if (minutes < 2) return resolve(msg("in under a minute"));
  if (minutes < 60) return resolve(msg("in {minutes}m", { minutes }));
  const hours = Math.round(minutes / 60);
  if (hours < 24) return resolve(msg("in {hours}h", { hours }));
  return resolve(msg("in {days}d", { days: Math.round(hours / 24) }));
}

export function nextRunLabel(
  task: Pick<ScheduledTask, "enabled" | "nextRunAt">,
  now: number,
  resolve: MessageResolver = m,
): string {
  if (!task.enabled) return resolve(msg("Paused", { $context: "automation status" }));
  return task.nextRunAt
    ? resolve(msg("Next run {time}", { time: relativeLabel(task.nextRunAt, now, resolve) }))
    : resolve(msg("Not scheduled"));
}

/**
 * A run succeeds once its prompt is delivered (a new thread, or a send that
 * may steer a turn already running), not when the agent finishes. Say "sent".
 */
export function lastRunLabel(
  task: Pick<ScheduledTask, "lastRunStatus" | "lastRunAt">,
  now: number,
  resolve: MessageResolver = m,
): string | null {
  switch (task.lastRunStatus) {
    case "never":
      return null;
    case "running":
      return resolve(msg("Sending…"));
    case "failed":
      return resolve(msg("Couldn't send"));
    case "succeeded":
      // Past-only: a run that finished after the last clock tick reads "just now".
      return task.lastRunAt
        ? resolve(msg("Sent {time}", { time: formatRelativeTimeLabel(task.lastRunAt, now) }))
        : resolve(msg("Sent", { $context: "automation run status" }));
  }
}

type ScheduleMode = "fixed" | "once" | "interval";
export type WorkspaceMode = "root" | "worktree" | "existing_worktree";

export interface DraftState {
  readonly editingId: string | null;
  readonly title: string;
  readonly prompt: string;
  readonly enabled: boolean;
  readonly scheduleMode: ScheduleMode;
  readonly intervalMinutes: string;
  readonly timeOfDay: string;
  /** Local date and time as a `datetime-local` input value, such as 2026-11-02T15:00. */
  readonly runAt: string;
  /** The stored ISO run time, sent back unchanged when the field was not edited. */
  readonly savedRunAt: string;
  readonly weekdays: ReadonlySet<number>;
  readonly projectId: string;
  readonly threadId: string;
  /** The thread the form opened with, so a save can tell a cleared destination from an unbound one. */
  readonly savedThreadId: string;
  readonly threadMode: ScheduledTaskThreadMode;
  readonly workspaceMode: WorkspaceMode;
  readonly baseRef: string;
  readonly startFromOrigin: boolean;
  /** Tracked repositories the new worktree takes; undefined leaves the server's default. */
  readonly repositories: ReadonlyArray<string> | undefined;
  readonly existingWorktreePath: string;
  readonly modelSelection: ModelSelection | null;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
}

/** Formats a date as a `datetime-local` input value in the browser's time zone. */
export function toDateTimeLocalValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function scheduleDraftErrors(draft: DraftState, resolve: MessageResolver = m) {
  if (draft.scheduleMode === "fixed" && !draft.timeOfDay)
    return [{ title: resolve(msg("Invalid run time")), description: resolve(msg("Pick a time.")) }];
  if (draft.scheduleMode !== "once") return [];
  const runAt = new Date(draft.runAt);
  if (Number.isNaN(runAt.getTime()))
    return [
      {
        title: resolve(msg("Invalid run time")),
        description: resolve(msg("Pick a date and time.")),
      },
    ];
  // A time skipped by a daylight saving change parses to a different clock time.
  if (toDateTimeLocalValue(runAt) !== draft.runAt)
    return [
      {
        title: resolve(msg("Invalid run time")),
        description: resolve(msg("That time does not exist in your time zone.")),
      },
    ];
  return [];
}

export function scheduleFromDraft(draft: DraftState): ScheduledTaskSchedule | null {
  if (scheduleDraftErrors(draft).length > 0) return null;
  if (draft.scheduleMode === "once") {
    const saved = draft.savedRunAt ? new Date(draft.savedRunAt) : null;
    if (saved !== null && toDateTimeLocalValue(saved) === draft.runAt)
      return { type: "once", runAt: draft.savedRunAt };
    // A `datetime-local` value has no offset. In an hour that repeats when clocks go
    // back, keep the saved time's offset; otherwise Date reads it as local time.
    const withSavedOffset =
      saved === null
        ? null
        : new Date(Date.parse(`${draft.runAt}Z`) + saved.getTimezoneOffset() * 60_000);
    return {
      type: "once",
      runAt:
        withSavedOffset !== null && toDateTimeLocalValue(withSavedOffset) === draft.runAt
          ? withSavedOffset.toISOString()
          : new Date(draft.runAt).toISOString(),
    };
  }
  if (draft.scheduleMode === "interval") {
    const everyMs = Math.round(Number(draft.intervalMinutes) * 60_000);
    return { type: "interval", everyMs };
  }
  const selectedEveryDay = draft.weekdays.size === 0 || draft.weekdays.size === 7;
  return {
    type: "fixed_time",
    timeOfDay: draft.timeOfDay,
    ...(selectedEveryDay ? {} : { weekdays: [...draft.weekdays].toSorted() }),
  };
}

export function taskToDraft(task: ScheduledTask): DraftState {
  const schedule = task.schedule;
  const weekdays =
    schedule.type === "fixed_time" && schedule.weekdays && schedule.weekdays.length > 0
      ? new Set(schedule.weekdays)
      : new Set([0, 1, 2, 3, 4, 5, 6]);
  return {
    editingId: task.id,
    title: task.title,
    prompt: task.prompt,
    enabled: task.enabled,
    scheduleMode: schedule.type === "fixed_time" ? "fixed" : schedule.type,
    intervalMinutes:
      schedule.type === "interval" ? String(Math.max(1, schedule.everyMs / 60_000)) : "15",
    // A time input shows nothing for an unpadded hour such as 9:05, which agents may save.
    timeOfDay: schedule.type === "fixed_time" ? schedule.timeOfDay.padStart(5, "0") : "09:00",
    runAt: schedule.type === "once" ? toDateTimeLocalValue(new Date(schedule.runAt)) : "",
    savedRunAt: schedule.type === "once" ? schedule.runAt : "",
    weekdays,
    projectId: task.projectId,
    threadId: task.threadId ?? "",
    savedThreadId: task.threadId ?? "",
    threadMode: scheduledTaskThreadMode(task),
    workspaceMode: task.workspaceStrategy.type,
    baseRef: task.workspaceStrategy.type === "worktree" ? task.workspaceStrategy.baseRef : "",
    startFromOrigin:
      task.workspaceStrategy.type === "worktree"
        ? (task.workspaceStrategy.startFromOrigin ?? false)
        : true,
    repositories:
      task.workspaceStrategy.type === "worktree"
        ? task.workspaceStrategy.repositories?.map((repository) => repository.path)
        : undefined,
    existingWorktreePath:
      task.workspaceStrategy.type === "existing_worktree"
        ? task.workspaceStrategy.worktreePath
        : "",
    modelSelection: task.modelSelection,
    runtimeMode: task.runtimeMode,
    interactionMode: task.interactionMode,
  };
}

export function moveDraftToThread(
  draft: DraftState,
  thread: { readonly id: ThreadId; readonly projectId: ProjectId },
): DraftState {
  return {
    ...draft,
    threadId: thread.id,
    projectId: thread.projectId,
    threadMode: draft.threadMode === "new_thread" ? "continue" : draft.threadMode,
  };
}

/** Leaves the thread but keeps the mode. Matches MCP: new threads stay out of the shared checkout. */
export function unbindDraftFromThread(draft: DraftState): DraftState {
  if (!draft.threadId) return draft;
  return {
    ...draft,
    threadId: "",
    ...(draft.workspaceMode === "root"
      ? { workspaceMode: "worktree" as const, startFromOrigin: true }
      : {}),
  };
}

export function changeDraftProject(draft: DraftState, projectId: string): DraftState {
  if (projectId === draft.projectId) return draft;
  return { ...unbindDraftFromThread(draft), projectId, repositories: undefined };
}

/** Threads a task can move to. The current one is left out; the picker always shows it. */
export function scheduledTaskDestinationThreads(
  threads: ReadonlyArray<EnvironmentThreadShell>,
  target: {
    readonly environmentId: EnvironmentId;
    readonly projectId: string;
    readonly currentThreadId: ThreadId | null;
    readonly query: string;
  },
): ReadonlyArray<EnvironmentThreadShell> {
  const search = target.query.trim().toLocaleLowerCase();
  return threads
    .filter(
      (thread) =>
        thread.environmentId === target.environmentId &&
        thread.projectId === target.projectId &&
        thread.id !== target.currentThreadId &&
        thread.archivedAt === null &&
        isListedThreadLineage(thread.lineage) &&
        thread.title.toLocaleLowerCase().includes(search),
    )
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function scheduledTaskDefaultModel(
  settings: ServerSettings,
  project: (LegacyProjectSettingsFields & { readonly id: ProjectId }) | null,
  entries: readonly ProviderInstanceEntry[],
): ModelSelection | null {
  const available = entries.filter(
    (entry) =>
      entry.enabled &&
      entry.installed &&
      entry.isAvailable &&
      entry.snapshot.auth.status !== "unauthenticated",
  );
  const configured = resolveProjectSettings(settings, project?.id ?? null, project).settings
    .defaultModelSelection;
  for (const selection of [configured, settings.defaultModelSelection]) {
    if (
      selection &&
      available.some(
        (entry) =>
          entry.instanceId === selection.instanceId &&
          entry.models.find((model) => model.slug === selection.model)?.isLegacy !== true,
      )
    )
      return selection;
  }
  const models = available.flatMap((entry) =>
    entry.models
      .filter((model) => !model.isLegacy)
      .map((model) => ({ instanceId: entry.instanceId, model })),
  );
  const fallback = models.find(({ model }) => model.isDefault) ?? models[0];
  return fallback ? { instanceId: fallback.instanceId, model: fallback.model.slug } : null;
}

/**
 * A new automation's project: a pinned open project, then any open one. An archived
 * project only when the page is scoped to it, so that scope can still save.
 */
export function defaultAutomationProjectId<
  TProject extends {
    readonly id: ProjectId;
    readonly pinnedAt?: string | null | undefined;
    readonly archivedAt?: string | null | undefined;
  },
>(scopedProjects: ReadonlyArray<TProject>, scope: ResolvedSettingsScope): ProjectId | "" {
  const open = scopedProjects.filter((project) => project.archivedAt == null);
  const scopedToProject = scope.kind === "project" || scope.kind === "checkout";
  return (
    (
      open.find((project) => project.pinnedAt != null) ??
      open[0] ??
      (scopedToProject ? scopedProjects[0] : undefined)
    )?.id ?? ""
  );
}
