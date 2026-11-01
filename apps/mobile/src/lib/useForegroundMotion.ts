import { NavigationContext } from "@react-navigation/native";
import { useCallback, useContext, useSyncExternalStore } from "react";

import { useAppActive } from "./appState";
import { useReducedMotionPreference } from "./useReducedMotionPreference";

/** Loading motion only runs while its screen is visible and the app is active. */
export function useForegroundMotion() {
  const reducedMotion = useReducedMotionPreference();
  const navigation = useContext(NavigationContext);
  const subscribeFocus = useCallback(
    (listener: () => void) => {
      const unsubscribeFocus = navigation?.addListener("focus", listener);
      const unsubscribeBlur = navigation?.addListener("blur", listener);
      return () => {
        unsubscribeFocus?.();
        unsubscribeBlur?.();
      };
    },
    [navigation],
  );
  const focused = useSyncExternalStore(subscribeFocus, () => navigation?.isFocused() ?? true);
  const active = useAppActive();
  return !reducedMotion && focused && active;
}
