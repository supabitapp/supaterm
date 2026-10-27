import { useSyncExternalStore } from "react";
import { AppState } from "react-native";

type Listener = () => void;

export function subscribeAppState(onChange: Listener): () => void {
  const subscription = AppState.addEventListener("change", () => onChange());
  return () => subscription.remove();
}

export function isAppActive(): boolean {
  return AppState.currentState === "active";
}

export function useAppActive(): boolean {
  return useSyncExternalStore(subscribeAppState, isAppActive);
}

function isAppForeground(): boolean {
  return AppState.currentState !== "background";
}

/**
 * True unless the app is backgrounded. Unlike useAppActive, the transient
 * "inactive" state (Control Center, the app switcher, a system prompt) still
 * counts as foreground, so live streams do not reconnect around it.
 */
export function useAppForeground(): boolean {
  return useSyncExternalStore(subscribeAppState, isAppForeground);
}
