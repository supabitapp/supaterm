import { secondTick } from "@supaterm/client-runtime/clock";
import { useSyncExternalStore } from "react";

export function useNowSecond() {
  return useSyncExternalStore(secondTick.subscribe, secondTick.getSnapshot, secondTick.getSnapshot);
}
