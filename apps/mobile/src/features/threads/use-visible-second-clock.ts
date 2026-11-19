import { useIsFocused } from "@react-navigation/native";
import { secondTick } from "@supaterm/client-runtime/clock";
import { useSyncExternalStore } from "react";

import { useAppActive } from "../../lib/appState";
import { usePaneRole } from "../../components/ui/Pane";

const subscribeNever = () => () => undefined;

/**
 * Retained routes stay mounted when hidden, so an ungated tick would keep
 * re-rendering them. Every visible label shares one module-level tick.
 */
export function useVisibleSecondClock(enabled: boolean) {
  const focused = useIsFocused();
  const inSidebar = usePaneRole() === "sidebar";
  const appActive = useAppActive();
  const ticking = enabled && (focused || inSidebar) && appActive;
  return useSyncExternalStore(
    ticking ? secondTick.subscribe : subscribeNever,
    secondTick.getSnapshot,
    secondTick.getSnapshot,
  );
}
