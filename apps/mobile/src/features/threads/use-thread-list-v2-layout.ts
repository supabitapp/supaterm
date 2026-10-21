import { useMemo } from "react";

import { buildThreadListV2Items, threadListInboxReturns } from "./threadListV2";

type ThreadListV2LayoutInput = Required<
  Omit<Parameters<typeof buildThreadListV2Items>[0], "inboxReturnAt">
>;

/** Keeps Home and the iPad sidebar on the same partition. */
export function useThreadListV2Layout({
  grouping,
  groupingProjects,
  threads,
  environmentId,
  projectRefs,
  searchQuery,
  matchedThreadKeys,
  pendingOrder,
  queuedThreadKeys,
  doneLimit,
  now,
  pinnedShelfExpanded,
  activeShelfExpanded,
  workingShelfExpanded,
  collapsedGroups,
  snoozedShelfExpanded,
  doneShelfExpanded,
  selectedThreadKey,
}: ThreadListV2LayoutInput) {
  const threadListV2Layout = useMemo(() => {
    threadListInboxReturns.observe(threads);
    // Done threads remain live shells; archived threads stay hidden.
    return buildThreadListV2Items({
      grouping,
      groupingProjects,
      pendingOrder,
      threads: threads.filter((thread) => thread.archivedAt === null),
      environmentId,
      projectRefs,
      searchQuery,
      matchedThreadKeys,
      queuedThreadKeys,
      doneLimit,
      now,
      pinnedShelfExpanded,
      activeShelfExpanded,
      workingShelfExpanded,
      collapsedGroups,
      inboxReturnAt: threadListInboxReturns.returnedAt,
      snoozedShelfExpanded,
      doneShelfExpanded,
      selectedThreadKey,
    });
  }, [
    pinnedShelfExpanded,
    activeShelfExpanded,
    workingShelfExpanded,
    collapsedGroups,
    pendingOrder,
    queuedThreadKeys,
    now,
    snoozedShelfExpanded,
    doneShelfExpanded,
    selectedThreadKey,
    environmentId,
    searchQuery,
    matchedThreadKeys,
    doneLimit,
    grouping,
    groupingProjects,
    threads,
    projectRefs,
  ]);
  return { threadListV2Layout };
}
