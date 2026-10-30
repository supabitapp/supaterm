import { useSyncExternalStore } from "react";
import { AccessibilityInfo, AppState } from "react-native";

type Listener = () => void;

export function subscribeAppState(onChange: Listener): () => void {
  const subscription = AppState.addEventListener("change", () => onChange());
  return () => subscription.remove();
}

export function isAppActive(): boolean {
  return AppState.currentState === "active";
}

export function subscribeAppActive(onActive: Listener): () => void {
  const subscription = AppState.addEventListener("change", (state) => {
    if (state === "active") onActive();
  });
  return () => subscription.remove();
}

export function useAppActive(): boolean {
  return useSyncExternalStore(subscribeAppState, isAppActive);
}

function isAppForeground(): boolean {
  return AppState.currentState !== "background";
}

export function useAppForeground(): boolean {
  return useSyncExternalStore(subscribeAppState, isAppForeground);
}

let reduceMotionEnabled: boolean | null = null;
const reduceMotionListeners = new Set<Listener>();
let reduceMotionSubscription: { remove: () => void } | null = null;

function setReduceMotionEnabled(next: boolean) {
  if (next === reduceMotionEnabled) return;
  reduceMotionEnabled = next;
  for (const listener of reduceMotionListeners) listener();
}

export function subscribeReduceMotion(onChange: Listener): () => void {
  reduceMotionListeners.add(onChange);
  if (reduceMotionSubscription === null) {
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotionEnabled,
    );
    reduceMotionSubscription = subscription;

    void AccessibilityInfo.isReduceMotionEnabled().then(
      (enabled) => {
        if (reduceMotionSubscription === subscription) setReduceMotionEnabled(enabled);
      },
      () => undefined,
    );
  }
  return () => {
    reduceMotionListeners.delete(onChange);
    if (reduceMotionListeners.size === 0) {
      reduceMotionSubscription?.remove();
      reduceMotionSubscription = null;

      reduceMotionEnabled = null;
    }
  };
}

export function readReduceMotionEnabled(): boolean {
  return reduceMotionEnabled ?? true;
}

export function useReduceMotionEnabled(): boolean {
  return useSyncExternalStore(subscribeReduceMotion, readReduceMotionEnabled);
}
