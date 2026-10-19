import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";

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
  return {
    loaded,
    pinnedShelfExpanded,
    activeShelfExpanded,
    doneShelfExpanded,
    snoozedShelfExpanded,
    workingShelfExpanded,
    togglePinnedShelf,
    toggleActiveShelf,
    toggleDoneShelf,
    toggleSnoozedShelf,
    toggleWorkingShelf,
  } as const;
}
