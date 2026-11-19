import * as Clock from "effect/Clock";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Ref from "effect/Ref";

const REFRESH_TIMEOUT = Duration.seconds(30);

type Entry<A> =
  | { readonly _tag: "Empty" }
  | { readonly _tag: "Scanning"; readonly scan: Deferred.Deferred<A> }
  | {
      readonly _tag: "Ready";
      readonly value: A;
      readonly expiresAtNanos: bigint;
      readonly refreshing: boolean;
    };

export const makeStaleWhileRevalidate = Effect.fn("StaleWhileRevalidate.make")(function* <A>(
  discover: Effect.Effect<A>,
  ttl: Duration.Input,
) {
  const ttlNanos = Duration.toNanosUnsafe(Duration.fromInputUnsafe(ttl));
  const scope = yield* Effect.scope;
  const state = yield* Ref.make<Entry<A>>({ _tag: "Empty" });

  const settle = Effect.fn("StaleWhileRevalidate.settle")(function* (exit: Exit.Exit<A>) {
    const now = yield* Clock.monotonicTimeNanos;
    yield* Ref.update(
      state,
      (entry) =>
        (Exit.isSuccess(exit)
          ? {
              _tag: "Ready",
              value: exit.value,
              expiresAtNanos: now + ttlNanos,
              refreshing: false,
            }
          : entry._tag === "Ready"
            ? { ...entry, refreshing: false }
            : { _tag: "Empty" }) satisfies Entry<A>,
    );
  });
  const fork = (scan: Effect.Effect<unknown>) =>
    scan.pipe(Effect.ignoreCause({ log: true }), Effect.interruptible, Effect.forkIn(scope));
  const firstScan = (scan: Deferred.Deferred<A>) =>
    fork(
      discover.pipe(
        Effect.onExit((exit) => settle(exit).pipe(Effect.andThen(Deferred.done(scan, exit)))),
      ),
    );
  const refresh = fork(discover.pipe(Effect.onExit(settle), Effect.timeoutOption(REFRESH_TIMEOUT)));

  return Effect.gen(function* () {
    const now = yield* Clock.monotonicTimeNanos;
    const result = yield* Ref.modify(state, (entry) => {
      switch (entry._tag) {
        case "Empty": {
          const scan = Deferred.makeUnsafe<A>();
          return [
            [firstScan(scan), Deferred.await(scan)],
            { _tag: "Scanning", scan },
          ] satisfies readonly [readonly [Effect.Effect<unknown>, Effect.Effect<A>], Entry<A>];
        }
        case "Scanning":
          return [[Effect.void, Deferred.await(entry.scan)], entry] satisfies readonly [
            readonly [Effect.Effect<unknown>, Effect.Effect<A>],
            Entry<A>,
          ];
        case "Ready":
          return (
            entry.refreshing || entry.expiresAtNanos > now
              ? [[Effect.void, Effect.succeed(entry.value)], entry]
              : [[refresh, Effect.succeed(entry.value)], { ...entry, refreshing: true }]
          ) satisfies readonly [readonly [Effect.Effect<unknown>, Effect.Effect<A>], Entry<A>];
      }
    }).pipe(
      Effect.flatMap(([start, result]) => Effect.as(start, result)),
      Effect.uninterruptible,
    );
    return yield* result;
  });
});
