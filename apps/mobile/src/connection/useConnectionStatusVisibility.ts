import { useEffect, useState } from "react";
import { AppState } from "react-native";

import { createConnectionStatusDelay } from "./status-delay";

export function useConnectionStatusVisibility(key: string, pending: boolean, immediate = false) {
  const [lifecycle, setLifecycle] = useState({
    active: AppState.currentState === "active",
    revision: 0,
  });
  const [shownKey, setShownKey] = useState<string | null>(null);
  const [delay] = useState(() => createConnectionStatusDelay(setShownKey));
  const currentKey = `${key}:${lifecycle.revision}`;

  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- Tracks native app lifecycle events and disposes the visibility timer on unmount.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      delay.pause();
      setLifecycle((current) => ({ active: state === "active", revision: current.revision + 1 }));
    });
    return () => {
      subscription.remove();
      delay.dispose();
    };
  }, [delay]);

  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- Schedules the visibility timer for the current connection and foreground state.
  useEffect(() => {
    delay.update({ key: currentKey, pending, active: lifecycle.active, immediate });
  }, [delay, currentKey, pending, lifecycle.active, immediate]);

  return pending && lifecycle.active && (immediate || shownKey === currentKey);
}
