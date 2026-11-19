import { useAtomValue } from "@effect/atom-react";
import type { SidebarThreadGrouping } from "@supaterm/contracts";
import { AsyncResult } from "effect/reactivity";
import { mobilePreferencesAtom, saveMobilePreferences } from "./preferences";
import { useAtomCommand } from "./use-atom-command";

export function useMobileThreadGrouping() {
  const preferences = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomCommand(saveMobilePreferences);
  const loaded = AsyncResult.isSuccess(preferences);
  const grouping = loaded ? (preferences.value.threadGrouping ?? "status") : "status";
  const setGrouping = (threadGrouping: SidebarThreadGrouping) =>
    void savePreferences({ threadGrouping });
  return { grouping, setGrouping, loaded };
}
