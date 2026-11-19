// @effect-diagnostics globalTimers:off globalDate:off - Render clocks for React hooks, outside an Effect runtime.

import type { EnvironmentId } from "@supaterm/contracts";

/**
 * A `useSyncExternalStore`-shaped clock. Snapshots stay cached between
 * notifications while subscribed, as `useSyncExternalStore` requires.
 */
export interface ClockStore<A> {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => A;
}

const MAX_TIMEOUT_MS = 2_147_483_647;

function makeTickStore<A>(read: () => A, periodMs: number): ClockStore<A>;
function makeTickStore<A>(read: () => A, periodMs: number) {
  let value = read();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();

  const schedule = () => {
    timer = setTimeout(
      () => {
        timer = undefined;
        const next = read();
        if (next !== value) {
          value = next;
          for (const listener of listeners) listener();
        }
        if (listeners.size > 0 && timer === undefined) schedule();
      },
      periodMs - (Date.now() % periodMs),
    );
  };

  return {
    subscribe: (listener) => {
      if (listeners.size === 0) {
        value = read();
        schedule();
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          clearTimeout(timer);
          timer = undefined;
        }
      };
    },
    getSnapshot: () => {
      if (timer === undefined) value = read();
      return value;
    },
  } satisfies ClockStore<A>;
}

/** Epoch ms floored to the second, advancing on each wall-clock second. */
export const secondTick: ClockStore<number> = makeTickStore(
  () => Math.floor(Date.now() / 1000) * 1000,
  1000,
);

/** ISO timestamp truncated to the minute (`YYYY-MM-DDTHH:mm`). */
export const minuteTick: ClockStore<string> = makeTickStore(
  () => new Date().toISOString().slice(0, 16),
  60_000,
);

const serverClockOffsets = new Map<EnvironmentId, number>();

/**
 * The host stamped `serverTimeMs` between the request and its reply, so the
 * offset lies within that window. Keep the one nearest 0, so clocks that agree
 * read as 0 instead of shifting every timer by network latency.
 */
export function recordServerClock(
  environmentId: EnvironmentId,
  sample: {
    readonly serverTimeMs: number | undefined;
    readonly requestedAtMs: number;
    readonly receivedAtMs: number;
  },
) {
  const { serverTimeMs, requestedAtMs, receivedAtMs } = sample;
  if (serverTimeMs === undefined || !Number.isFinite(serverTimeMs)) {
    serverClockOffsets.delete(environmentId);
    return;
  }
  serverClockOffsets.set(
    environmentId,
    serverTimeMs > receivedAtMs
      ? serverTimeMs - receivedAtMs
      : serverTimeMs < requestedAtMs
        ? serverTimeMs - requestedAtMs
        : 0,
  );
}

/** Converts client epoch milliseconds to the environment's clock. */
export function toServerClock(environmentId: EnvironmentId, clientMs: number) {
  return clientMs + (serverClockOffsets.get(environmentId) ?? 0);
}

export interface DeadlineStore extends ClockStore<boolean> {
  /**
   * Re-checks `Date.now()` and notifies if the deadline has passed. For callers
   * that observe the deadline first, e.g. a click after a throttled or slept
   * timer, so the snapshot catches up without waiting for the late timer.
   */
  readonly refresh: () => void;
}

const neverPassed: DeadlineStore = {
  subscribe: () => () => {},
  getSnapshot: () => false,
  refresh: () => {},
};

interface DeadlineEntry {
  readonly store: DeadlineStore;
  readonly listeners: Set<() => void>;
  passed: boolean;
  timer: ReturnType<typeof setTimeout> | undefined;
}

const deadlines = new Map<number, DeadlineEntry>();

function passDeadline(entry: DeadlineEntry) {
  clearTimeout(entry.timer);
  entry.timer = undefined;
  entry.passed = true;
  for (const listener of entry.listeners) listener();
}

function armDeadline(entry: DeadlineEntry, deadlineMs: number) {
  const delay = deadlineMs - Date.now();
  if (delay <= 0) {
    passDeadline(entry);
    return;
  }
  entry.timer = setTimeout(() => armDeadline(entry, deadlineMs), Math.min(delay, MAX_TIMEOUT_MS));
}

/** The epoch-ms deadline `delayMs` from now, for `deadlineStore`. */
export function deadlineAfter(delayMs: number) {
  return Date.now() + delayMs;
}

/**
 * Whether `Date.now()` has reached `deadlineMs`. One timer per distinct
 * deadline, shared by its subscribers; once passed the snapshot stays true.
 * Deadlines register only while subscribed, so renders React discards leak nothing.
 * A non-finite deadline never passes.
 */
export function deadlineStore(deadlineMs: number | null) {
  if (deadlineMs === null || !Number.isFinite(deadlineMs)) return neverPassed;
  const existing = deadlines.get(deadlineMs);
  if (existing !== undefined) return existing.store;

  const store: DeadlineStore = {
    subscribe: (listener) => {
      let entry = deadlines.get(deadlineMs);
      if (entry === undefined) {
        entry = { store, listeners: new Set(), passed: Date.now() >= deadlineMs, timer: undefined };
        deadlines.set(deadlineMs, entry);
        if (!entry.passed) armDeadline(entry, deadlineMs);
      }
      const joined = entry;
      joined.listeners.add(listener);
      return () => {
        joined.listeners.delete(listener);
        if (joined.listeners.size > 0) return;
        clearTimeout(joined.timer);
        joined.timer = undefined;
        if (deadlines.get(deadlineMs) === joined) deadlines.delete(deadlineMs);
      };
    },
    getSnapshot: () => deadlines.get(deadlineMs)?.passed ?? Date.now() >= deadlineMs,
    refresh: () => {
      const entry = deadlines.get(deadlineMs);
      if (entry !== undefined && !entry.passed && Date.now() >= deadlineMs) passDeadline(entry);
    },
  };
  return store;
}
