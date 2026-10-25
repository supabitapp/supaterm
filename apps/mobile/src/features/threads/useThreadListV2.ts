import type { EnvironmentId } from "@supaterm/contracts";
import { useMemo } from "react";

import { scopedProjectKey } from "../../lib/scopedEntities";
import type { PendingNewTask } from "../../state/use-pending-new-tasks";
import {
  buildThreadListV2Items,
  buildThreadListV2ListItems,
  threadListInboxReturns,
} from "./threadListV2";

/**
 * Screens' select handlers read the content-only key set; a fresh one per list rebuild gave
 * every row a new handler whenever any thread shell changed. Keyed by a string, the set keeps
 * its identity until its keys change.
 */
function useKeySet(newlineSeparatedKeys: string): ReadonlySet<string> {
  return useMemo(
    () => new Set(newlineSeparatedKeys.length === 0 ? [] : newlineSeparatedKeys.split("\n")),
    [newlineSeparatedKeys],
  );
}

type LayoutInput = Parameters<typeof buildThreadListV2Items>[0];

/**
 * Home's and the iPad sidebar's thread list, so both keep the same partition. Its result is
 * one value a screen only reads: built inline, the list's inputs stayed open to mutation
 * across the screen's other hooks, so the React Compiler cached none of it and every render
 * of the screen re-rendered every row.
 */
export function useThreadListV2(input: {
  readonly grouping: NonNullable<LayoutInput["grouping"]>;
  readonly groupingProjects: NonNullable<LayoutInput["groupingProjects"]>;
  readonly threads: LayoutInput["threads"];
  readonly pendingTasks: ReadonlyArray<PendingNewTask>;
  readonly environmentId: EnvironmentId | null;
  readonly projectRefs: NonNullable<LayoutInput["projectRefs"]> | null;
  readonly searchQuery: string;
  /** Threads that match the search by content, keyed like `threadSearchMatchKey`. */
  readonly searchMatches: ReadonlyMap<string, unknown>;
  readonly pendingOrder: LayoutInput["pendingOrder"];
  readonly queuedThreadKeys: ReadonlySet<string>;
  readonly loadedEnvironmentIds: ReadonlySet<EnvironmentId>;
  readonly doneLimit: number;
  readonly now: string;
  readonly shelfPreferencesLoaded: boolean;
  readonly pinnedShelfExpanded: boolean;
  readonly activeShelfExpanded: boolean;
  readonly workingShelfExpanded: boolean;
  readonly collapsedGroups: readonly string[];
  readonly snoozedShelfExpanded: boolean;
  readonly doneShelfExpanded: boolean;
  readonly selectedThreadKey: string | null;
}) {
  const { threads } = input;
  // Observed once per change to the threads: that is when a thread can stop working.
  const inboxReturnAt = useMemo(() => threadListInboxReturns.observe(threads), [threads]);
  // Done threads remain live shells; archived threads stay hidden.
  const layout = buildThreadListV2Items({
    grouping: input.grouping,
    groupingProjects: input.groupingProjects,
    pendingOrder: input.pendingOrder,
    threads: threads.filter((thread) => thread.archivedAt === null),
    environmentId: input.environmentId,
    projectRefs: input.projectRefs,
    searchQuery: input.searchQuery,
    matchedThreadKeys: new Set(input.searchMatches.keys()),
    queuedThreadKeys: input.queuedThreadKeys,
    doneLimit: input.doneLimit,
    now: input.now,
    pinnedShelfExpanded: input.pinnedShelfExpanded,
    activeShelfExpanded: input.activeShelfExpanded,
    workingShelfExpanded: input.workingShelfExpanded,
    collapsedGroups: input.collapsedGroups,
    inboxReturnAt,
    snoozedShelfExpanded: input.snoozedShelfExpanded,
    doneShelfExpanded: input.doneShelfExpanded,
    selectedThreadKey: input.selectedThreadKey,
  });
  const contentOnlyThreadKeys = useKeySet([...layout.contentOnlyThreadKeys].sort().join("\n"));
  const scopedProjectKeys =
    input.projectRefs === null
      ? null
      : new Set(input.projectRefs.map((ref) => scopedProjectKey(ref.environmentId, ref.projectId)));
  const searchQuery = input.searchQuery.trim().toLocaleLowerCase();
  const pendingTasks = input.pendingTasks.filter(
    (pendingTask) =>
      (input.environmentId === null || pendingTask.environmentId === input.environmentId) &&
      (scopedProjectKeys === null ||
        scopedProjectKeys.has(
          scopedProjectKey(pendingTask.environmentId, pendingTask.projectId),
        )) &&
      (searchQuery.length === 0 || pendingTask.title.toLocaleLowerCase().includes(searchQuery)),
  );
  const items = buildThreadListV2ListItems({
    ...layout,
    pendingTasks,
    pinnedShelfExpanded: input.pinnedShelfExpanded,
    activeShelfExpanded: input.activeShelfExpanded,
    workingShelfExpanded: input.workingShelfExpanded,
    snoozedShelfExpanded: input.snoozedShelfExpanded,
    doneShelfExpanded: input.doneShelfExpanded,
    snoozeLabelNow: `${input.now.slice(0, 16)}:00.000Z`,
    loadedEnvironmentIds: input.loadedEnvironmentIds,
    queuedThreadKeys: input.queuedThreadKeys,
    shelfPreferencesLoading: !input.shelfPreferencesLoaded,
  });
  return { layout, items, contentOnlyThreadKeys };
}
