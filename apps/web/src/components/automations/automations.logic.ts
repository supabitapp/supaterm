import {
  EnvironmentId,
  type ProjectId,
  ScheduledTaskId,
  type ScheduledTask,
  type ScheduledTaskSchedule,
  type ModelSelection,
  type RuntimeMode,
  type ProviderInteractionMode,
  type ServerSettings,
} from "@supaterm/contracts";

import {
  resolveProjectSettings,
  type LegacyProjectSettingsFields,
} from "@supaterm/shared/projectSettings";
import type { ProviderInstanceEntry } from "../../providerInstances";
import { formatRelativeTimeLabel } from "../../timestampFormat";
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

export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

const ONCE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

/** Fixed times run on the environment's clock, which may not be this device's. */
export function scheduleLabel(schedule: ScheduledTaskSchedule): string {
  if (schedule.type === "once") return `Once, ${ONCE_FORMATTER.format(new Date(schedule.runAt))}`;
  if (schedule.type === "interval") {
    const minutes = schedule.everyMs / 60_000;
    return Number.isInteger(minutes)
      ? `Every ${minutes} min`
      : `Every ${Math.round(schedule.everyMs / 1000)} sec`;
  }
  const weekdays = schedule.weekdays ?? [];
  const days =
    weekdays.length === 0
      ? "Daily"
      : weekdays.length === 5 && weekdays.every((day) => day >= 1 && day <= 5)
        ? "Weekdays"
        : weekdays.map((day) => WEEKDAY_LABELS[day]).join(", ");
  return `${days} at ${schedule.timeOfDay} (environment time)`;
}

/** "in 5m" for upcoming instants, "5m ago" for past ones. */
export function relativeLabel(value: string, now: number): string {
  const diffMs = Date.parse(value) - now;
  if (!(diffMs > 0)) return formatRelativeTimeLabel(value, now);
  const minutes = Math.ceil(diffMs / 60_000);
  if (minutes < 2) return "in under a minute";
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${hours}h`;
  return `in ${Math.round(hours / 24)}d`;
}

export function nextRunLabel(
  task: Pick<ScheduledTask, "enabled" | "nextRunAt">,
  now: number,
): string {
  if (!task.enabled) return "Paused";
  return task.nextRunAt ? `Next run ${relativeLabel(task.nextRunAt, now)}` : "Not scheduled";
}

/**
 * A run succeeds once its prompt is delivered (a new thread, or a send that
 * may steer a turn already running), not when the agent finishes. Say "sent".
 */
export function lastRunLabel(
  task: Pick<ScheduledTask, "lastRunStatus" | "lastRunAt">,
  now: number,
): string | null {
  switch (task.lastRunStatus) {
    case "never":
      return null;
    case "running":
      return "Sending…";
    case "failed":
      return "Couldn't send";
    case "succeeded":
      // Past-only: a run that finished after the last clock tick reads "just now".
      return task.lastRunAt ? `Sent ${formatRelativeTimeLabel(task.lastRunAt, now)}` : "Sent";
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
  readonly workspaceMode: WorkspaceMode;
  readonly baseRef: string;
  readonly startFromOrigin: boolean;
  readonly existingWorktreePath: string;
  readonly modelKey: string;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
  /**
   * The picker only edits `instanceId:model`; keeping the source object preserves provider
   * options (reasoning, temperature, …) when the model itself is left unchanged.
   */
  readonly baseModelSelection: ModelSelection | null;
}

/** Formats a date as a `datetime-local` input value in the browser's time zone. */
export function toDateTimeLocalValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function scheduleDraftErrors(draft: DraftState) {
  if (draft.scheduleMode !== "once") return [];
  const runAt = new Date(draft.runAt);
  if (Number.isNaN(runAt.getTime()))
    return [{ title: "Invalid run time", description: "Pick a date and time." }];
  // A time skipped by a daylight saving change parses to a different clock time.
  if (toDateTimeLocalValue(runAt) !== draft.runAt)
    return [
      { title: "Invalid run time", description: "That time does not exist in your time zone." },
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
    timeOfDay: draft.timeOfDay || "09:00",
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
    timeOfDay: schedule.type === "fixed_time" ? schedule.timeOfDay : "09:00",
    runAt: schedule.type === "once" ? toDateTimeLocalValue(new Date(schedule.runAt)) : "",
    savedRunAt: schedule.type === "once" ? schedule.runAt : "",
    weekdays,
    projectId: task.projectId,
    threadId: task.threadId ?? "",
    workspaceMode: task.workspaceStrategy.type,
    baseRef: task.workspaceStrategy.type === "worktree" ? task.workspaceStrategy.baseRef : "main",
    startFromOrigin:
      task.workspaceStrategy.type === "worktree"
        ? (task.workspaceStrategy.startFromOrigin ?? false)
        : true,
    existingWorktreePath:
      task.workspaceStrategy.type === "existing_worktree"
        ? task.workspaceStrategy.worktreePath
        : "",
    modelKey: `${task.modelSelection.instanceId}:${task.modelSelection.model}`,
    runtimeMode: task.runtimeMode,
    interactionMode: task.interactionMode,
    baseModelSelection: task.modelSelection,
  };
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
