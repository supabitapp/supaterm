import { useSyncExternalStore } from "react";
import { AppState } from "react-native";

type Listener = () => void;

export function subscribeAppState(onChange: Listener) {
  const subscription = AppState.addEventListener("change", () => onChange());
  return () => subscription.remove();
}

export function isAppActive() {
  return AppState.currentState === "active";
}

/** Runs `onActive` each time the app returns to the foreground. */
export function subscribeAppActive(onActive: Listener) {
  const subscription = AppState.addEventListener("change", (state) => {
    if (state === "active") onActive();
  });
  return () => subscription.remove();
}

export function useAppActive() {
  return useSyncExternalStore(subscribeAppState, isAppActive);
}

function isAppForeground() {
  return AppState.currentState !== "background";
}

/**
 * True unless the app is backgrounded. Unlike useAppActive, the transient
 * "inactive" state (Control Center, the app switcher, a system prompt) still
 * counts as foreground, so live streams do not reconnect around it.
 */
export function useAppForeground() {
  return useSyncExternalStore(subscribeAppState, isAppForeground);
}
