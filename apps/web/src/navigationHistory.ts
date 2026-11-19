import { useSyncExternalStore } from "react";

export type HistoryDirection = "back" | "forward";

function subscribeToNavigationHistory(onChange: () => void): () => void;
function subscribeToNavigationHistory(onChange: () => void) {
  window.navigation.addEventListener("currententrychange", onChange);
  return (() =>
    window.navigation.removeEventListener("currententrychange", onChange)) satisfies () => void;
}

export function canNavigateHistory(direction: HistoryDirection): boolean;
export function canNavigateHistory(direction: HistoryDirection) {
  return (
    direction === "back" ? window.navigation.canGoBack : window.navigation.canGoForward
  ) satisfies boolean;
}

export function navigateHistory(direction: HistoryDirection) {
  if (direction === "back") window.history.back();
  else window.history.forward();
}

/** Only for Electron: the Navigation API is Chromium-only. */
export function useCanNavigateHistory(direction: HistoryDirection): boolean;
export function useCanNavigateHistory(direction: HistoryDirection) {
  return useSyncExternalStore(subscribeToNavigationHistory, () =>
    canNavigateHistory(direction),
  ) satisfies boolean;
}
