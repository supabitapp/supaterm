import { scopeThreadRef, scopedThreadKey } from "@supaterm/client-runtime/environment";
import type { EnvironmentThreadShell } from "@supaterm/client-runtime/state/shell";
import {
  collapseThreadGroups,
  groupInboxThreads,
  type ThreadGroupingProject,
} from "@supaterm/client-runtime/state/thread-grouping";
import {
  isThreadWorking,
  sortInboxThreadsByReturn,
  sortWorkingThreadsBySend,
} from "@supaterm/client-runtime/state/thread-inbox";
import type { SidebarThreadGrouping } from "@supaterm/contracts/settings";
import {
  applySidebarThreadDrop,
  sidebarListItemId,
  type SidebarListItem,
  type SidebarSection,
} from "./Sidebar.logic";

type ThreadIdentity = Pick<EnvironmentThreadShell, "environmentId" | "id">;

export function threadShellKey(thread: ThreadIdentity) {
  return scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
}

function rowsOf(threads: readonly ThreadIdentity[], section: SidebarSection): SidebarListItem[] {
  return threads.map((thread) => ({ kind: "thread", key: threadShellKey(thread), section }));
}

interface SidebarInboxInput {
  readonly mode: SidebarThreadGrouping;
  readonly active: readonly EnvironmentThreadShell[];
  readonly working: readonly EnvironmentThreadShell[];
  readonly visibleWorking: readonly EnvironmentThreadShell[];
  readonly projects: readonly ThreadGroupingProject[];
  readonly now: string;
  readonly collapsedGroups: ReadonlySet<string>;
  readonly routeThreadKey: string | null;
}

export function buildSidebarInboxItems(input: SidebarInboxInput): SidebarListItem[] {
  if (input.mode === "status") {
    return [
      ...rowsOf(input.active, "active"),
      ...(input.working.length === 0
        ? []
        : [
            { kind: "marker", marker: "working-header" } as const,
            ...rowsOf(input.visibleWorking, "working"),
          ]),
    ];
  }
  const workingKeys = new Set(input.working.map(threadShellKey));
  const groups = groupInboxThreads({
    threads: [...input.active, ...input.working],
    ...(input.mode === "project"
      ? { mode: input.mode, projects: input.projects }
      : { mode: input.mode, now: input.now }),
  });
  return collapseThreadGroups(
    groups,
    input.collapsedGroups,
    (thread) => threadShellKey(thread) === input.routeThreadKey,
  ).flatMap((group): SidebarListItem[] => [
    {
      kind: "group",
      key: group.key,
      label: group.label,
      projectKey: group.projectKey,
      count: group.count,
      collapsed: group.collapsed,
    },
    ...group.threads.map((thread): SidebarListItem => {
      const key = threadShellKey(thread);
      return { kind: "thread", key, section: workingKeys.has(key) ? "working" : "active" };
    }),
  ]);
}

export function buildSidebarListItems(input: {
  readonly hasThreads: boolean;
  readonly pinned: readonly ThreadIdentity[];
  readonly snoozed: readonly ThreadIdentity[];
  readonly done: readonly ThreadIdentity[];
  readonly showSnoozed: boolean;
  readonly inboxItems: readonly SidebarListItem[];
}): readonly SidebarListItem[] {
  if (!input.hasThreads) return [{ kind: "marker", marker: "drafts-block" }];
  const items: SidebarListItem[] = [
    { kind: "marker", marker: "pinned-header" },
    ...rowsOf(input.pinned, "pinned"),
    { kind: "marker", marker: "drafts-block" },
    { kind: "marker", marker: "pinned-divider" },
    { kind: "marker", marker: "active-placeholder" },
  ];
  items.push(...input.inboxItems);
  if (input.showSnoozed) {
    items.push({ kind: "marker", marker: "snoozed-header" }, ...rowsOf(input.snoozed, "snoozed"));
  }
  items.push(
    { kind: "marker", marker: "done-header" },
    { kind: "marker", marker: "done-placeholder" },
    ...rowsOf(input.done, "done"),
  );
  return items;
}

export function sidebarListLayoutKey(items: readonly SidebarListItem[]): string {
  return JSON.stringify(
    items.map((item) => [
      sidebarListItemId(item),
      item.kind === "thread"
        ? item.section
        : item.kind === "group"
          ? [item.label, item.collapsed, item.count]
          : "",
    ]),
  );
}

export function previewDraggedInbox(
  input: SidebarInboxInput & {
    readonly drag: { readonly activeKey: string; readonly occurredAt: string } | null;
    readonly threadByKey: ReadonlyMap<string, EnvironmentThreadShell>;
    readonly inboxReturnAt: (thread: EnvironmentThreadShell) => number | undefined;
    readonly workingShelfExpanded: boolean;
  },
) {
  if (input.drag === null) return undefined;
  const dragged = input.threadByKey.get(input.drag.activeKey);
  if (dragged === undefined) return undefined;
  const activeKey = input.drag.activeKey;
  const withoutDragged = (threads: readonly EnvironmentThreadShell[]) =>
    threads.filter((thread) => threadShellKey(thread) !== activeKey);
  const active = withoutDragged(input.active);
  const working = withoutDragged(input.working);
  const visibleWorking = withoutDragged(input.visibleWorking);
  const returning = applySidebarThreadDrop(dragged, "active", input.drag.occurredAt);
  const returningIsWorking = isThreadWorking(returning);
  return {
    active: buildSidebarInboxItems({
      ...input,
      active: returningIsWorking
        ? active
        : sortInboxThreadsByReturn([...active, returning], input.inboxReturnAt),
      working: returningIsWorking ? sortWorkingThreadsBySend([...working, returning]) : working,
      visibleWorking:
        returningIsWorking && (input.workingShelfExpanded || input.routeThreadKey === activeKey)
          ? sortWorkingThreadsBySend([...visibleWorking, returning])
          : visibleWorking,
    }),
    other: buildSidebarInboxItems({ ...input, active, working, visibleWorking }),
  };
}
