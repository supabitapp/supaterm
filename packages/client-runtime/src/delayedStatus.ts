const STATUS_SHOW_DELAY_MS = 400;
const STATUS_MIN_VISIBLE_MS = 400;

/**
 * A status shows only after it has stayed set for a moment, then stays shown
 * for a minimum time so a quick flicker never flashes on screen.
 * `deadlinePassed` tells whether `delayedStatusDeadline(state)` has been reached.
 */
export type DelayedStatusState<A> =
  | { readonly phase: "idle"; readonly key: string }
  | { readonly phase: "pending"; readonly key: string; readonly showAt: number }
  | {
      readonly phase: "shown";
      readonly key: string;
      readonly value: A;
      readonly holdUntil: number;
    };

export interface DelayedStatusInput<A> {
  readonly key: string;
  /** Compared by identity, so use strings or other stable values. */
  readonly value: A | null;
  readonly deadlinePassed: boolean;
  readonly showDelayMs?: number | undefined;
}

/**
 * Returns `state` itself when nothing changes, so it can run on every render.
 * `now` is read only to stamp a new deadline; it is a function so a memoizing
 * caller (the React Compiler) cannot cache a stale clock reading.
 */
export function stepDelayedStatus<A>(
  state: DelayedStatusState<A> | null,
  { key, value, deadlinePassed, showDelayMs = STATUS_SHOW_DELAY_MS }: DelayedStatusInput<A>,
  now: () => number,
) {
  const idle = () => ({ phase: "idle", key }) satisfies DelayedStatusState<A>;
  const pending = () =>
    ({
      phase: "pending",
      key,
      showAt: now() + showDelayMs,
    }) satisfies DelayedStatusState<A>;
  const shown = (shownValue: A) =>
    ({
      phase: "shown",
      key,
      value: shownValue,
      holdUntil: now() + STATUS_MIN_VISIBLE_MS,
    }) satisfies DelayedStatusState<A>;

  if (state === null || state.key !== key)
    return (value === null ? idle() : pending()) satisfies DelayedStatusState<A>;
  switch (state.phase) {
    case "idle":
      return (value === null ? state : pending()) satisfies DelayedStatusState<A>;
    case "pending":
      if (value === null) return idle() satisfies DelayedStatusState<A>;
      return (deadlinePassed ? shown(value) : state) satisfies DelayedStatusState<A>;
    case "shown":
      if (value === null) return (deadlinePassed ? idle() : state) satisfies DelayedStatusState<A>;
      return (value === state.value ? state : shown(value)) satisfies DelayedStatusState<A>;
  }
}

export function delayedStatusDeadline<A>(state: DelayedStatusState<A>) {
  switch (state.phase) {
    case "idle":
      return null;
    case "pending":
      return state.showAt;
    case "shown":
      return state.holdUntil;
  }
}

export function shownDelayedStatus<A>(state: DelayedStatusState<A>, key: string) {
  return state.phase === "shown" && state.key === key ? state.value : null;
}
