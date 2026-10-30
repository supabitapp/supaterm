import { deadlineStore, minuteTick } from "@supaterm/client-runtime/clock";
import { useState, useSyncExternalStore } from "react";

export function useDeadlinePassed(deadlineMs: number | null): boolean {
  const store = deadlineStore(deadlineMs);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

export function useNowAfter(deadlineMs: number | null): number {
  const passed = useDeadlinePassed(deadlineMs);
  const readNow = () => ({ deadlineMs, passed, nowMs: Date.now() });
  const [snapshot, setSnapshot] = useState(readNow);

  if (snapshot.deadlineMs !== deadlineMs || snapshot.passed !== passed) setSnapshot(readNow);
  return snapshot.nowMs;
}

export function minuteTickToEpochMs(minute: string): number {
  return Date.parse(`${minute}:00Z`);
}

export function useNowMinuteMs(): number {
  return minuteTickToEpochMs(
    useSyncExternalStore(minuteTick.subscribe, minuteTick.getSnapshot, minuteTick.getSnapshot),
  );
}
