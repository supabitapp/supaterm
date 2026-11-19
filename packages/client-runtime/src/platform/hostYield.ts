import * as Effect from "effect/Effect";

export const yieldToHostTimer = Effect.callback<void>((resume) => {
  // @effect-diagnostics-next-line globalTimersInEffect:off - A host timer, not Effect.sleep, is the point.
  const timer = setTimeout(() => resume(Effect.void), 0);
  return Effect.sync(() => clearTimeout(timer));
});
