import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

export function rpcInitialItems<A>(items: ReadonlyArray<A>) {
  let pending: ReadonlyArray<A> | undefined = items;
  return Stream.unwrap(
    Effect.sync(() => {
      const initial = pending;
      pending = undefined;
      return initial === undefined ? Stream.empty : Stream.fromIterable(initial);
    }),
  );
}
