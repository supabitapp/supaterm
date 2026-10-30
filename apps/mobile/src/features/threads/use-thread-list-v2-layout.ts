import type { OlderSettledScope } from "@supaterm/client-runtime/state/threads";
import { useAtomValue } from "@effect/atom-react";
import { useMemo, useSyncExternalStore } from "react";
import { environmentServerConfigsAtom } from "../../state/server";
import { useOlderSettledShelf, useOlderSettledShelfGrowth } from "../../state/olderSettledShelf";
import { buildThreadListV2Items, threadListInboxReturns } from "./threadListV2";

type ThreadListV2LayoutInput = Omit<
  Parameters<typeof buildThreadListV2Items>[0],
  "inboxReturnAt" | "isWorking" | "isListedSettled" | "unloadedSettledCount"
>;

export function useThreadListV2Layout(input: ThreadListV2LayoutInput) {
  const configs = useAtomValue(environmentServerConfigsAtom);
  const version = useSyncExternalStore(
    threadListInboxReturns.subscribe,
    threadListInboxReturns.getSnapshot,
  );
  const inbox = useMemo(
    () => threadListInboxReturns.observe(input.threads),
    // oxlint-disable-next-line react/memo-dependencies -- Grace expiry invalidates the snapshot.
    [input.threads, version],
  );
  const environmentIds = input.environmentId === null ? [...configs.keys()] : [input.environmentId];
  const scopes = environmentIds.flatMap((environmentId): OlderSettledScope[] => {
    if (input.projectRefs == null) return [{ environmentId, projectIds: null }];
    const projectIds = input.projectRefs.flatMap((ref) =>
      ref.environmentId === environmentId ? [ref.projectId] : [],
    );
    return projectIds.length > 0 ? [{ environmentId, projectIds }] : [];
  });
  const olderSettledShelf = useOlderSettledShelf({
    scopes,
    expanded: input.doneShelfExpanded !== false,
    visibleCount: input.searchQuery.trim().length === 0 ? (input.doneLimit ?? 0) : 0,
  });
  const threadListV2Layout = buildThreadListV2Items({
    ...input,
    inboxReturnAt: inbox.returnedAt,
    isWorking: inbox.isWorking,
    isListedSettled: olderSettledShelf.isListed,
    unloadedSettledCount: olderSettledShelf.unloadedCount(input.threads),
  });
  useOlderSettledShelfGrowth(olderSettledShelf, threadListV2Layout.listedSettledThreads);
  const contentOnlyKey = [...threadListV2Layout.contentOnlyThreadKeys].sort().join("\n");
  const contentOnlyThreadKeys = useMemo(
    () => new Set(contentOnlyKey ? contentOnlyKey.split("\n") : []),
    [contentOnlyKey],
  );
  return { threadListV2Layout, olderSettledShelf, contentOnlyThreadKeys };
}
