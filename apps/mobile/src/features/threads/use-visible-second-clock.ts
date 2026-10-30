import { useIsFocused } from "@react-navigation/native";
import { secondTick } from "@supaterm/client-runtime/clock";
import { useSyncExternalStore } from "react";
import { AppState } from "react-native";

const subscribeActivity = (listener: () => void) => {
  const subscription = AppState.addEventListener("change", listener);
  return () => subscription.remove();
};

const subscribeNever = () => () => undefined;

export function useVisibleSecondClock(enabled: boolean): number {
  const focused = useIsFocused();
  const active = useSyncExternalStore(subscribeActivity, () => AppState.currentState === "active");
  return useSyncExternalStore(
    enabled && focused && active ? secondTick.subscribe : subscribeNever,
    secondTick.getSnapshot,
    secondTick.getSnapshot,
  );
}
