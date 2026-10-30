import { useInsertionEffect, useRef, useState } from "react";

/** Call only from handlers and effects; render sees the previous commit's fn. */
export function useStableCallback<Args extends ReadonlyArray<unknown>, Result>(
  fn: (...args: Args) => Result,
): (...args: Args) => Result {
  const latest = useRef(fn);
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- publishes the current callback before child layout effects invoke its stable reference
  useInsertionEffect(() => {
    latest.current = fn;
  });
  const [stable] = useState(
    () =>
      (...args: Args) =>
        latest.current(...args),
  );
  return stable;
}
