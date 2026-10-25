import type { OlderDoneScope } from "@supaterm/client-runtime/state/threads";
import type { EnvironmentId } from "@supaterm/contracts";
import { useMemo, useSyncExternalStore } from "react";

import { scopedProjectKey } from "../../lib/scopedEntities";
import { useOlderDoneShelf, useOlderDoneShelfGrowth } from "../../state/olderDoneShelf";
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
  // A thread can stop working when the threads change, or when its exit grace expires.
  const inboxVersion = useSyncExternalStore(
    threadListInboxReturns.subscribe,
    threadListInboxReturns.getSnapshot,
  );
  const inbox = useMemo(
    () => threadListInboxReturns.observe(threads),
    // oxlint-disable-next-line react/memo-dependencies -- the version signals an expired grace
    [threads, inboxVersion],
  );
  // Older done threads load in pages; the shelf lists them only as far as they are loaded.
  const scopes = olderDoneScopes(input);
  const olderDoneShelf = useOlderDoneShelf({
    scopes,
    expanded: input.doneShelfExpanded,
    // A search lists only matches, so the shelf would page forever; loaded pages stay.
    visibleCount: input.searchQuery.trim().length === 0 ? input.doneLimit : 0,
  });
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
    isListedDone: olderDoneShelf.isListed,
    unloadedDoneCount: olderDoneShelf.unloadedCount(
      threads.filter(
        (thread) =>
          thread.archivedAt === null &&
          scopes.some(
            (scope) =>
              scope.environmentId === thread.environmentId &&
              (scope.projectIds === null || scope.projectIds.includes(thread.projectId)),
          ),
      ),
    ),
    now: input.now,
    pinnedShelfExpanded: input.pinnedShelfExpanded,
    activeShelfExpanded: input.activeShelfExpanded,
    workingShelfExpanded: input.workingShelfExpanded,
    collapsedGroups: input.collapsedGroups,
    inboxReturnAt: inbox.returnedAt,
    isWorking: inbox.isWorking,
    snoozedShelfExpanded: input.snoozedShelfExpanded,
    doneShelfExpanded: input.doneShelfExpanded,
    selectedThreadKey: input.selectedThreadKey,
  });
  useOlderDoneShelfGrowth(olderDoneShelf, layout.listedDoneThreads);
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
    ...(olderDoneShelf.loading
      ? { olderDoneState: "loading" as const }
      : olderDoneShelf.failed
        ? { olderDoneState: "failed" as const }
        : {}),
  });
  return { layout, items, contentOnlyThreadKeys, olderDoneShelf };
}

/** The list's scope per environment: its projects there, or every project. */
function olderDoneScopes(input: {
  readonly environmentId: EnvironmentId | null;
  readonly projectRefs: LayoutInput["projectRefs"];
  readonly loadedEnvironmentIds: ReadonlySet<EnvironmentId>;
}): ReadonlyArray<OlderDoneScope> {
  const environmentIds =
    input.environmentId === null ? [...input.loadedEnvironmentIds] : [input.environmentId];
  return environmentIds.flatMap((environmentId): ReadonlyArray<OlderDoneScope> => {
    if (input.projectRefs == null) return [{ environmentId, projectIds: null }];
    const projectIds = input.projectRefs.flatMap((ref) =>
      ref.environmentId === environmentId ? [ref.projectId] : [],
    );
    return projectIds.length === 0 ? [] : [{ environmentId, projectIds }];
  });
}
