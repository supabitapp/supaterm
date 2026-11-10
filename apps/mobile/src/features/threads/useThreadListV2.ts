import { useAtomValue } from "@effect/atom-react";
import { withoutOfflineEnvironmentThreads } from "@supaterm/client-runtime/state/presentation";
import type { EnvironmentThreadShell } from "@supaterm/client-runtime/state/shell";
import type { OlderDoneScope } from "@supaterm/client-runtime/state/threads";
import type { EnvironmentId } from "@supaterm/contracts";
import { useMemo, useSyncExternalStore } from "react";

import { scopedProjectKey } from "../../lib/scopedEntities";
import { useOlderDoneShelf, useOlderDoneShelfGrowth } from "../../state/olderDoneShelf";
import { offlineEnvironmentIdsAtom } from "../../state/presentation";
import type { PendingNewTask } from "../../state/use-pending-new-tasks";
import {
  buildThreadListV2Items,
  buildThreadListV2ListItems,
  threadListInboxReturns,
  threadListV2LayoutTime,
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

const NO_LISTED_DONE: ReadonlyArray<EnvironmentThreadShell> = [];
const NO_HIDDEN_ENVIRONMENTS: ReadonlySet<EnvironmentId> = new Set();

/**
 * The React Compiler drops unread dependencies, so pass the expired-grace version through
 * this call to keep inbox updates tied to its subscription.
 */
function observeInbox(
  threads: Parameters<typeof threadListInboxReturns.observe>[0],
  _expiredGraceVersion: number,
) {
  return threadListInboxReturns.observe(threads);
}

/**
 * Home's and the iPad sidebar's thread list, so both keep the same partition. Shelf callbacks
 * prevent compiler caching across the whole derivation, so each stage keeps its own memo
 * boundary to preserve the list's identity during unrelated navigation renders.
 */
export function useThreadListV2(input: {
  readonly grouping: NonNullable<LayoutInput["grouping"]>;
  readonly groupingProjects: NonNullable<LayoutInput["groupingProjects"]>;
  readonly threads: LayoutInput["threads"];
  readonly hideOfflineEnvironments: boolean;
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
  const layoutTime = useMemo(
    () => threadListV2LayoutTime({ threads, now: input.now, searchQuery: input.searchQuery }),
    [threads, input.now, input.searchQuery],
  );
  // A thread can stop working when the threads change, or when its exit grace expires.
  const inboxVersion = useSyncExternalStore(
    threadListInboxReturns.subscribe,
    threadListInboxReturns.getSnapshot,
  );
  const inbox = useMemo(() => observeInbox(threads, inboxVersion), [threads, inboxVersion]);
  const offlineEnvironmentIds = useAtomValue(offlineEnvironmentIdsAtom);
  const hiddenEnvironmentIds = input.hideOfflineEnvironments
    ? offlineEnvironmentIds
    : NO_HIDDEN_ENVIRONMENTS;
  const listedThreads = useMemo(
    () => withoutOfflineEnvironmentThreads(threads, hiddenEnvironmentIds, input.selectedThreadKey),
    [threads, hiddenEnvironmentIds, input.selectedThreadKey],
  );
  // Older done threads load in pages; the shelf lists them only as far as they are loaded.
  const scopes = useMemo(
    () =>
      olderDoneScopes(
        {
          environmentId: input.environmentId,
          projectRefs: input.projectRefs,
          loadedEnvironmentIds: input.loadedEnvironmentIds,
        },
        hiddenEnvironmentIds,
      ),
    [input.environmentId, input.projectRefs, input.loadedEnvironmentIds, hiddenEnvironmentIds],
  );
  const olderDoneShelf = useOlderDoneShelf({
    scopes,
    expanded: input.doneShelfExpanded,
    // A search lists only matches, so the shelf would page forever; loaded pages stay.
    visibleCount: input.searchQuery.trim().length === 0 ? input.doneLimit : 0,
  });
  const { isListed, unloadedCount } = olderDoneShelf;
  // Done threads remain live shells; archived threads stay hidden.
  const layout = useMemo(
    () =>
      buildThreadListV2Items({
        grouping: input.grouping,
        groupingProjects: input.groupingProjects,
        pendingOrder: input.pendingOrder,
        threads: listedThreads.filter((thread) => thread.archivedAt === null),
        environmentId: input.environmentId,
        projectRefs: input.projectRefs,
        searchQuery: input.searchQuery,
        matchedThreadKeys: new Set(input.searchMatches.keys()),
        queuedThreadKeys: input.queuedThreadKeys,
        doneLimit: input.doneLimit,
        isListedDone: isListed,
        unloadedDoneCount: unloadedCount(
          listedThreads.filter(
            (thread) =>
              thread.archivedAt === null &&
              scopes.some(
                (scope) =>
                  scope.environmentId === thread.environmentId &&
                  (scope.projectIds === null || scope.projectIds.includes(thread.projectId)),
              ),
          ),
        ),
        now: layoutTime,
        pinnedShelfExpanded: input.pinnedShelfExpanded,
        activeShelfExpanded: input.activeShelfExpanded,
        workingShelfExpanded: input.workingShelfExpanded,
        collapsedGroups: input.collapsedGroups,
        inboxReturnAt: inbox.returnedAt,
        isWorking: inbox.isWorking,
        snoozedShelfExpanded: input.snoozedShelfExpanded,
        doneShelfExpanded: input.doneShelfExpanded,
        selectedThreadKey: input.selectedThreadKey,
      }),
    [
      input.grouping,
      input.groupingProjects,
      input.pendingOrder,
      listedThreads,
      input.environmentId,
      input.projectRefs,
      input.searchQuery,
      input.searchMatches,
      input.queuedThreadKeys,
      input.doneLimit,
      isListed,
      unloadedCount,
      scopes,
      layoutTime,
      input.pinnedShelfExpanded,
      input.activeShelfExpanded,
      input.workingShelfExpanded,
      input.collapsedGroups,
      inbox.returnedAt,
      inbox.isWorking,
      input.snoozedShelfExpanded,
      input.doneShelfExpanded,
      input.selectedThreadKey,
    ],
  );
  useOlderDoneShelfGrowth(
    olderDoneShelf,
    layout.kind === "shelves" ? layout.listedDoneThreads : NO_LISTED_DONE,
  );
  const contentOnlyThreadKeys = useKeySet([...layout.contentOnlyThreadKeys].sort().join("\n"));
  const pendingTasks = useMemo(() => {
    const scopedProjectKeys =
      input.projectRefs === null
        ? null
        : new Set(
            input.projectRefs.map((ref) => scopedProjectKey(ref.environmentId, ref.projectId)),
          );
    const searchQuery = input.searchQuery.trim().toLocaleLowerCase();
    return input.pendingTasks.filter(
      (pendingTask) =>
        (input.environmentId === null || pendingTask.environmentId === input.environmentId) &&
        (scopedProjectKeys === null ||
          scopedProjectKeys.has(
            scopedProjectKey(pendingTask.environmentId, pendingTask.projectId),
          )) &&
        (searchQuery.length === 0 || pendingTask.title.toLocaleLowerCase().includes(searchQuery)),
    );
  }, [input.projectRefs, input.searchQuery, input.pendingTasks, input.environmentId]);
  const olderDoneState = olderDoneShelf.loading
    ? ("loading" as const)
    : olderDoneShelf.failed
      ? ("failed" as const)
      : undefined;
  const items = useMemo(
    () =>
      buildThreadListV2ListItems({
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
        ...(olderDoneState === undefined ? {} : { olderDoneState }),
      }),
    [
      layout,
      pendingTasks,
      input.pinnedShelfExpanded,
      input.activeShelfExpanded,
      input.workingShelfExpanded,
      input.snoozedShelfExpanded,
      input.doneShelfExpanded,
      input.now,
      input.loadedEnvironmentIds,
      input.queuedThreadKeys,
      input.shelfPreferencesLoaded,
      olderDoneState,
    ],
  );
  return { layout, items, contentOnlyThreadKeys, olderDoneShelf };
}

/** The list's scope per environment: its projects there, or every project. */
function olderDoneScopes(
  input: {
    readonly environmentId: EnvironmentId | null;
    readonly projectRefs: LayoutInput["projectRefs"];
    readonly loadedEnvironmentIds: ReadonlySet<EnvironmentId>;
  },
  hiddenEnvironmentIds: ReadonlySet<EnvironmentId>,
): ReadonlyArray<OlderDoneScope> {
  const environmentIds = (
    input.environmentId === null ? [...input.loadedEnvironmentIds] : [input.environmentId]
  ).filter((environmentId) => !hiddenEnvironmentIds.has(environmentId));
  return environmentIds.flatMap((environmentId): ReadonlyArray<OlderDoneScope> => {
    if (input.projectRefs == null) return [{ environmentId, projectIds: null }];
    const projectIds = input.projectRefs.flatMap((ref) =>
      ref.environmentId === environmentId ? [ref.projectId] : [],
    );
    return projectIds.length === 0 ? [] : [{ environmentId, projectIds }];
  });
}
