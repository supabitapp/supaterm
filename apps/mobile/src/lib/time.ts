export function compareTimestamps(left: string, right: string) {
  return (Date.parse(left) || 0) - (Date.parse(right) || 0);
}

export function byTimestamp(newestFirst: boolean) {
  return (left: { readonly date: string }, right: { readonly date: string }) =>
    newestFirst
      ? compareTimestamps(right.date, left.date)
      : compareTimestamps(left.date, right.date);
}

export function relativeTime(input: string, nowMs?: number): string;
export function relativeTime(input: string, nowMs: number = Date.now()) {
  const timestamp = Date.parse(input);
  if (Number.isNaN(timestamp)) {
    return "<1m" satisfies string;
  }

  const deltaSeconds = Math.max(0, Math.floor((nowMs - timestamp) / 1000));
  if (deltaSeconds < 60) return "<1m" satisfies string;

  const deltaMinutes = Math.floor(deltaSeconds / 60);
  if (deltaMinutes < 60) return `${deltaMinutes}m` satisfies string;

  const deltaHours = Math.floor(deltaMinutes / 60);
  if (deltaHours < 24) return `${deltaHours}h` satisfies string;

  const deltaDays = Math.floor(deltaHours / 24);
  return `${deltaDays}d` satisfies string;
}

/** Milliseconds until the relative-time label next changes. */
export function msUntilRelativeTimeChange(input: string, nowMs: number = Date.now()) {
  const timestamp = Date.parse(input);
  if (Number.isNaN(timestamp)) return null;
  const elapsedMs = Math.max(0, nowMs - timestamp);
  const unitMs = elapsedMs < 3_600_000 ? 60_000 : elapsedMs < 86_400_000 ? 3_600_000 : 86_400_000;
  const nextChangeMs = timestamp + (Math.floor(elapsedMs / unitMs) + 1) * unitMs;
  return Math.min(nextChangeMs - nowMs, 86_400_000);
}
