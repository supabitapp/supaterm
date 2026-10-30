import { useMemo } from "react";
import type { EnvironmentId } from "@supaterm/contracts";
import type { PendingNewTask } from "../../state/use-pending-new-tasks";
import { scopedProjectKey } from "../../lib/scopedEntities";
import { buildThreadListV2ListItems } from "./threadListV2";
import { useThreadListV2Layout } from "./use-thread-list-v2-layout";

export function useThreadListV2(
  input: Parameters<typeof useThreadListV2Layout>[0] & {
    readonly pendingTasks: ReadonlyArray<PendingNewTask>;
    readonly loadedEnvironmentIds: ReadonlySet<EnvironmentId>;
    readonly shelfPreferencesLoaded: boolean;
  },
) {
  const { threadListV2Layout: layout, olderSettledShelf } = useThreadListV2Layout(input);
  const key = [...layout.contentOnlyThreadKeys].sort().join("\n");
  const contentOnlyThreadKeys = useMemo(() => new Set(key ? key.split("\n") : []), [key]);
  const projects =
    input.projectRefs == null
      ? null
      : new Set(input.projectRefs.map((ref) => scopedProjectKey(ref.environmentId, ref.projectId)));
  const query = input.searchQuery.trim().toLocaleLowerCase();
  const pendingTasks = input.pendingTasks.filter(
    (task) =>
      (input.environmentId === null || task.environmentId === input.environmentId) &&
      (projects === null || projects.has(scopedProjectKey(task.environmentId, task.projectId))) &&
      (query.length === 0 || task.title.toLocaleLowerCase().includes(query)),
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
  return { layout, items, contentOnlyThreadKeys, olderSettledShelf };
}
