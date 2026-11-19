import type { SidebarThreadGrouping } from "@supaterm/contracts";
import { scopedProjectKey } from "../environment/index.ts";
import type { EnvironmentThreadShell } from "./models.ts";
import type { ProjectGroup } from "./projectGrouping.ts";
import { toSortableTimestamp } from "./threadSort.ts";

export const THREAD_GROUPING_OPTIONS = [
  { value: "status", label: "Default" },
  { value: "project", label: "Project" },
] as const satisfies ReadonlyArray<{ value: SidebarThreadGrouping; label: string }>;

export type ThreadGroupingProject = Pick<ProjectGroup, "key" | "label" | "memberProjectRefs">;

export interface ThreadDisplayGroup<T> {
  readonly key: string;
  readonly label: string;
  /** The grouped project's key, or null for "Other projects". */
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

export function groupInboxThreadsByProject<T extends GroupableThread>(input: {
  readonly threads: readonly T[];
  readonly projects: readonly ThreadGroupingProject[];
}): ThreadDisplayGroup<T>[] {
  const ordered = input.threads
    .map((thread) => ({ thread, activityAt: resolveThreadActivityAt(thread) }))
    .sort(
      (left, right) =>
        right.activityAt - left.activityAt ||
        left.thread.id.localeCompare(right.thread.id) ||
        left.thread.environmentId.localeCompare(right.thread.environmentId),
    )
    .map(({ thread }) => thread);
  const groups: { key: string; label: string; projectKey: string | null; threads: T[] }[] = [];
  const groupByProjectRef = new Map<string, (typeof groups)[number]>();
  for (const project of input.projects) {
    const group = {
      key: `project:${project.key}`,
      label: project.label,
      projectKey: project.key,
      threads: [] as T[],
    };
    groups.push(group);
    for (const ref of project.memberProjectRefs)
      groupByProjectRef.set(scopedProjectKey(ref), group);
  }
  const fallback = {
    key: "project:unavailable",
    label: "Other projects",
    projectKey: null,
    threads: [] as T[],
  };
  groups.push(fallback);
  for (const thread of ordered) {
    (groupByProjectRef.get(scopedProjectKey(thread)) ?? fallback).threads.push(thread);
  }
  return groups.filter((group) => group.threads.length > 0);
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
