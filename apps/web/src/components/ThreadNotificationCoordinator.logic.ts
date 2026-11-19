import { WORKING_EXIT_GRACE_MS } from "@supaterm/client-runtime/state/thread-inbox";
import {
  effectiveSnoozed,
  type ThreadSnoozeShell,
} from "@supaterm/client-runtime/state/thread-snooze";

export type ThreadNotificationKind = "input" | "completion";

export interface ThreadNotificationObservation {
  /** Status and request key, or status and run without a request, while the thread needs attention. */
  readonly attention: string | null;
  /** The pending request's id, when it has one; null whenever attention is. */
  readonly requestId: string | null;
  /** The thread is idle and its latest run completed. */
  readonly settled: boolean;
  /** When the latest run completed, if it did. */
  readonly completedAt: number | null;
}

/**
 * Whether completion notifications are suppressed by snooze. A completion that landed
 * during the snooze stays suppressed even when its update is processed after the wake.
 */
export function isSnoozedForNotification(
  thread: ThreadSnoozeShell,
  completedAt: number | null,
  now: number,
): boolean {
  if (effectiveSnoozed(thread, { now: new Date(now).toISOString() })) return true;
  if (completedAt === null) return false;
  if (thread.snoozedAt != null && completedAt < Date.parse(thread.snoozedAt)) return false;
  return effectiveSnoozed(thread, { now: new Date(completedAt).toISOString() });
}

/**
 * Attention notifies at once. Completion waits out the Working shelf's exit grace,
 * because an orchestrator run can end moments before its continuation starts. Any
 * observation that is not settled during the wait cancels it.
 */
export function createThreadNotificationGate<Key>(
  notify: (key: Key, kind: ThreadNotificationKind) => void,
) {
  const pending = new Map<Key, { at: number; timer: ReturnType<typeof setTimeout> }>();
  const handled = new Map<Key, number>();
  const lastSettled = new Map<Key, number>();
  const cancel = (key: Key) => {
    clearTimeout(pending.get(key)?.timer);
    pending.delete(key);
  };
  const skip = (key: Key, at: number | null) => {
    if (at !== null && at > (handled.get(key) ?? -Infinity)) handled.set(key, at);
  };
  const attended = new Map<Key, Set<string>>();
  const attend = (
    key: Key,
    prior: ThreadNotificationObservation | undefined,
    next: ThreadNotificationObservation,
  ): boolean => {
    if (next.attention === null) {
      attended.delete(key);
      return false;
    }
    if (next.requestId === null) return next.attention !== prior?.attention;
    const seen = attended.get(key);
    if (seen?.has(next.attention)) return false;
    if (seen) seen.add(next.attention);
    else attended.set(key, new Set([next.attention]));
    return true;
  };
  return {
    observe(
      key: Key,
      prior: ThreadNotificationObservation | undefined,
      next: ThreadNotificationObservation,
      options: { readonly archived: boolean; readonly quiet: boolean; readonly snoozed: boolean },
    ): void {
      const silenced = options.archived || options.quiet || options.snoozed;
      if (next.settled && next.completedAt !== null) lastSettled.set(key, next.completedAt);
      if (!next.settled || silenced) cancel(key);
      if (!prior || silenced) skip(key, next.completedAt);
      const fresh = attend(key, prior, next);
      if (!prior || options.archived) return;
      if (fresh) {
        skip(key, lastSettled.get(key) ?? null);
        cancel(key);
        notify(key, "input");
        return;
      }
      const at = next.completedAt;
      if (!next.settled || at === null || at <= (handled.get(key) ?? -Infinity)) return;
      if (pending.get(key)?.at === at) return;
      cancel(key);
      pending.set(key, {
        at,
        timer: setTimeout(() => {
          pending.delete(key);
          handled.set(key, at);
          notify(key, "completion");
        }, WORKING_EXIT_GRACE_MS),
      });
    },
    retain(keys: ReadonlySet<Key>): void {
      for (const key of pending.keys()) if (!keys.has(key)) cancel(key);
      for (const key of handled.keys()) if (!keys.has(key)) handled.delete(key);
      for (const key of lastSettled.keys()) if (!keys.has(key)) lastSettled.delete(key);
      for (const key of attended.keys()) if (!keys.has(key)) attended.delete(key);
    },
    cancelPending(): void {
      for (const key of pending.keys()) cancel(key);
    },
    clear(): void {
      for (const key of pending.keys()) cancel(key);
      handled.clear();
      lastSettled.clear();
      attended.clear();
    },
  };
}
