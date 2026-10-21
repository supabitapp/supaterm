import * as DateTime from "effect/DateTime";
import type { SidebarThreadGrouping } from "@supaterm/contracts";
import { scopedProjectKey } from "../environment/index.ts";
import type { EnvironmentThreadShell } from "./models.ts";
import type { ProjectGroup } from "./projectGrouping.ts";
import { toSortableTimestamp } from "./threadSort.ts";

export const THREAD_GROUPING_OPTIONS = [
  { value: "status", label: "Status" },
  { value: "project", label: "Project" },
  { value: "updated", label: "Updated" },
] as const satisfies ReadonlyArray<{ value: SidebarThreadGrouping; label: string }>;

export type ThreadGroupingProject = Pick<ProjectGroup, "key" | "label" | "memberProjectRefs">;

export type ThreadGroupingContext =
  | { readonly mode: "project"; readonly projects: readonly ThreadGroupingProject[] }
  | { readonly mode: "updated"; readonly now: string };

export interface ThreadDisplayGroup<T> {
  readonly key: string;
  readonly label: string;
  /** The grouped project's key, or null for update-time buckets and "Other projects". */
  readonly projectKey: string | null;
  readonly threads: readonly T[];
}

export interface CollapsibleThreadDisplayGroup<T> extends ThreadDisplayGroup<T> {
  readonly collapsed: boolean;
  readonly count: number;
}

type GroupableThread = Pick<
  EnvironmentThreadShell,
  | "id"
  | "environmentId"
  | "projectId"
  | "createdAt"
  | "reopenedAt"
  | "latestUserAuthoredMessageAt"
  | "latestUserMessageAt"
  | "latestRun"
>;

export function resolveThreadActivityAt(thread: GroupableThread): number {
  return Math.max(
    ...[
      thread.createdAt,
      thread.reopenedAt,
      thread.latestUserAuthoredMessageAt === undefined
        ? thread.latestUserMessageAt
        : thread.latestUserAuthoredMessageAt,
      thread.latestRun?.requestedAt,
      thread.latestRun?.completedAt,
    ].map((value) => toSortableTimestamp(value ?? undefined) ?? 0),
  );
}

export function groupInboxThreads<T extends GroupableThread>(
  input: { readonly threads: readonly T[] } & ThreadGroupingContext,
): ThreadDisplayGroup<T>[] {
  const ordered = input.threads
    .map((thread) => ({ thread, activityAt: resolveThreadActivityAt(thread) }))
    .sort(
      (left, right) =>
        right.activityAt - left.activityAt ||
        left.thread.id.localeCompare(right.thread.id) ||
        left.thread.environmentId.localeCompare(right.thread.environmentId),
    );
  const groups = new Map<
    string,
    { key: string; label: string; projectKey: string | null; threads: T[] }
  >();
  if (input.mode === "project") {
    const projectGroups = new Map<
      string,
      { key: string; label: string; projectKey: string | null; threads: T[] }
    >();
    for (const project of input.projects) {
      const key = `project:${project.key}`;
      const group = { key, label: project.label, projectKey: project.key, threads: [] as T[] };
      groups.set(key, group);
      for (const ref of project.memberProjectRefs) projectGroups.set(scopedProjectKey(ref), group);
    }
    const fallbackKey = "project:unavailable";
    const fallback = {
      key: fallbackKey,
      label: "Other projects",
      projectKey: null,
      threads: [] as T[],
    };
    groups.set(fallbackKey, fallback);
    for (const { thread } of ordered) {
      const group = projectGroups.get(scopedProjectKey(thread)) ?? fallback;
      group.threads.push(thread);
    }
  } else {
    const today = DateTime.startOf(
      DateTime.makeZonedUnsafe(input.now, { timeZone: DateTime.zoneMakeLocal() }),
      "day",
    );
    const yesterday = DateTime.subtract(today, { days: 1 });
    const week = DateTime.subtract(today, { days: 6 });
    const buckets = [
      { key: "updated:today", label: "Today", start: DateTime.toEpochMillis(today) },
      { key: "updated:yesterday", label: "Yesterday", start: DateTime.toEpochMillis(yesterday) },
      { key: "updated:week", label: "Last 7 days", start: DateTime.toEpochMillis(week) },
      { key: "updated:older", label: "Older", start: Number.NEGATIVE_INFINITY },
    ].map((bucket) => ({ ...bucket, projectKey: null, threads: [] as T[] }));
    for (const bucket of buckets) groups.set(bucket.key, bucket);
    for (const { thread, activityAt } of ordered) {
      const bucket = buckets.find((candidate) => activityAt >= candidate.start);
      bucket?.threads.push(thread);
    }
  }
  return [...groups.values()].filter((group) => group.threads.length > 0);
}

/** A collapsed group keeps only the threads `keepVisible` accepts, such as the open one. */
export function collapseThreadGroups<T>(
  groups: readonly ThreadDisplayGroup<T>[],
  collapsedKeys: ReadonlySet<string>,
  keepVisible: (thread: T) => boolean,
): CollapsibleThreadDisplayGroup<T>[] {
  return groups.map((group) => {
    const collapsed = collapsedKeys.has(group.key);
    return {
      ...group,
      collapsed,
      count: group.threads.length,
      threads: collapsed ? group.threads.filter(keepVisible) : group.threads,
    };
  });
}

export function toggleCollapsedThreadGroup(
  collapsedKeys: readonly string[],
  key: string,
): string[] {
  return collapsedKeys.includes(key)
    ? collapsedKeys.filter((candidate) => candidate !== key)
    : [...collapsedKeys, key];
}
