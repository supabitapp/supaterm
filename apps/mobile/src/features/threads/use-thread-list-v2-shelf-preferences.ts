import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { toggleCollapsedThreadGroup } from "@supaterm/client-runtime/state/thread-grouping";
import { AsyncResult } from "effect/reactivity";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";

const NO_COLLAPSED_GROUPS: readonly string[] = [];

export function useThreadListV2ShelfPreferences() {
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const loaded = AsyncResult.isSuccess(preferencesResult);
  const pinnedShelfExpanded =
    !loaded || preferencesResult.value.threadListPinnedShelfExpanded !== false;
  const activeShelfExpanded =
    !loaded || preferencesResult.value.threadListActiveShelfExpanded !== false;
  const snoozedShelfExpanded =
    loaded && preferencesResult.value.threadListSnoozedShelfExpanded === true;
  const doneShelfExpanded = loaded && preferencesResult.value.threadListDoneShelfExpanded === true;
  const workingShelfExpanded =
    loaded && preferencesResult.value.threadListWorkingShelfExpanded === true;
  const collapsedGroups =
    (loaded ? preferencesResult.value.threadListCollapsedGroups : undefined) ?? NO_COLLAPSED_GROUPS;
  const togglePinnedShelf = () => {
    if (!loaded) return;
    savePreferences({
      transform: (current) => ({
        threadListPinnedShelfExpanded: current.threadListPinnedShelfExpanded === false,
      }),
    });
  };
  const toggleActiveShelf = () => {
    if (!loaded) return;
    savePreferences({
      transform: (current) => ({
        threadListActiveShelfExpanded: current.threadListActiveShelfExpanded === false,
      }),
    });
  };
  const toggleSnoozedShelf = () => {
    if (!loaded) return;
    savePreferences({
      transform: (current) => ({
        threadListSnoozedShelfExpanded: current.threadListSnoozedShelfExpanded !== true,
      }),
    });
  };
  const toggleDoneShelf = () => {
    if (!loaded) return;
    savePreferences({
      transform: (current) => ({
        threadListDoneShelfExpanded: current.threadListDoneShelfExpanded !== true,
      }),
    });
  };
  const toggleWorkingShelf = () => {
    if (!loaded) return;
    savePreferences({
      transform: (current) => ({
        threadListWorkingShelfExpanded: current.threadListWorkingShelfExpanded !== true,
      }),
    });
  };
  const toggleGroup = (key: string) => {
    if (!loaded) return;
    savePreferences({
      transform: (current) => ({
        threadListCollapsedGroups: toggleCollapsedThreadGroup(
          current.threadListCollapsedGroups ?? NO_COLLAPSED_GROUPS,
          key,
        ),
      }),
    });
  };
  return {
    loaded,
    pinnedShelfExpanded,
    activeShelfExpanded,
    doneShelfExpanded,
    snoozedShelfExpanded,
    workingShelfExpanded,
    collapsedGroups,
    togglePinnedShelf,
    toggleActiveShelf,
    toggleDoneShelf,
    toggleSnoozedShelf,
    toggleWorkingShelf,
    toggleGroup,
  } as const;
}
