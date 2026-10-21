import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { SidebarThreadGrouping } from "@supaterm/contracts";
import { AsyncResult } from "effect/reactivity";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "./preferences";

export function useMobileThreadGrouping() {
  const preferences = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const loaded = AsyncResult.isSuccess(preferences);
  const grouping = loaded ? (preferences.value.threadGrouping ?? "status") : "status";
  const setGrouping = (threadGrouping: SidebarThreadGrouping) =>
    savePreferences({ threadGrouping });
  return { grouping, setGrouping, loaded };
}
