import { minuteTick } from "@supaterm/client-runtime/clock";
import { useSyncExternalStore } from "react";

export function useNowMinute(): string {
  return useSyncExternalStore(minuteTick.subscribe, minuteTick.getSnapshot, minuteTick.getSnapshot);
}

export function useNowMinuteMs(): number {
  return Date.parse(`${useNowMinute()}:00.000Z`);
}
