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
  readonly threads: readonly T[];
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
  const groups = new Map<string, { key: string; label: string; threads: T[] }>();
  if (input.mode === "project") {
    const projectGroups = new Map<string, { key: string; label: string; threads: T[] }>();
    for (const project of input.projects) {
      const key = `project:${project.key}`;
      const group = { key, label: project.label, threads: [] as T[] };
      groups.set(key, group);
      for (const ref of project.memberProjectRefs) projectGroups.set(scopedProjectKey(ref), group);
    }
    const fallbackKey = "project:unavailable";
    const fallback = { key: fallbackKey, label: "Other projects", threads: [] as T[] };
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
    ].map((bucket) => ({ ...bucket, threads: [] as T[] }));
    for (const bucket of buckets) groups.set(bucket.key, bucket);
    for (const { thread, activityAt } of ordered) {
      const bucket = buckets.find((candidate) => activityAt >= candidate.start);
      bucket?.threads.push(thread);
    }
  }
  return [...groups.values()].filter((group) => group.threads.length > 0);
}
