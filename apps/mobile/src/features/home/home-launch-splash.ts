import { useSyncExternalStore } from "react";

/**
 * Whether the launch splash still waits for Home's list. A list holds the splash while it
 * has cached rows to lay out, so the first frame after the splash shows them.
 */
export function createLaunchSplashHomeRows() {
  let holds = 0;
  let settled = false;
  const listeners = new Set<() => void>();
  const pending = () => !settled && holds > 0;
  const change = (apply: () => void) => {
    const before = pending();
    apply();
    if (pending() !== before) for (const listener of listeners) listener();
  };
  return {
    pending,
    hold: () => {
      let held = true;
      change(() => {
        holds += 1;
      });
      return () => {
        if (!held) return;
        held = false;
        change(() => {
          holds -= 1;
        });
      };
    },
    markDone: () =>
      change(() => {
        settled = true;
      }),
    subscribe: (onChange: () => void) => {
      listeners.add(onChange);
      return () => {
        listeners.delete(onChange);
      };
    },
  };
}

const homeRows = createLaunchSplashHomeRows();

export const holdLaunchSplashForHomeRows = homeRows.hold;
export const settleLaunchSplashHomeRows = homeRows.markDone;
export const launchSplashHomeRowsPending = homeRows.pending;

export function useLaunchSplashHomeRowsPending(): boolean {
  return useSyncExternalStore(homeRows.subscribe, homeRows.pending);
}

/**
 * Whether the native splash can hide: after the cached shells are read and Home's list has
 * laid out their rows. One limit ends both waits.
 */
export function splashCanHide(input: {
  readonly preferencesReady: boolean;
  readonly shellCachesRead: boolean;
  readonly homeRowsPending: boolean;
  readonly waitEnded: boolean;
}): boolean {
  if (!input.preferencesReady) return false;
  return input.waitEnded || (input.shellCachesRead && !input.homeRowsPending);
}
