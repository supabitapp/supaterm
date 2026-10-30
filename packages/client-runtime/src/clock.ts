// @effect-diagnostics globalTimers:off globalDate:off - Render clocks for React hooks, outside an Effect runtime.

export interface ClockStore<A> {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => A;
}

const MAX_TIMEOUT_MS = 2_147_483_647;

function makeTickStore<A>(read: () => A, periodMs: number): ClockStore<A> {
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
  };
}

export const secondTick: ClockStore<number> = makeTickStore(
  () => Math.floor(Date.now() / 1000) * 1000,
  1000,
);

export const minuteTick: ClockStore<string> = makeTickStore(
  () => new Date().toISOString().slice(0, 16),
  60_000,
);

export interface DeadlineStore extends ClockStore<boolean> {
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

export function deadlineAfter(delayMs: number): number {
  return Date.now() + delayMs;
}

export function deadlineStore(deadlineMs: number | null): DeadlineStore {
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
