import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import type { ConnectionCatalogEntry } from "./catalog.ts";
import type * as ConnectionDriver from "./driver.ts";
import type { ConnectionAttemptError } from "./model.ts";

type Lease = ConnectionDriver.EnvironmentConnectionLease;
type Progress = ConnectionDriver.ConnectionDriverProgress;

interface Replacement {
  readonly scope: Scope.Closeable;
  readonly fiber: Fiber.Fiber<Lease, ConnectionAttemptError>;
  readonly progress: SubscriptionRef.SubscriptionRef<ReadonlyArray<Progress>>;
}

/**
 * Holds at most one connection opened while the current session is still on
 * probation. Each handover between the slot and its owner is uninterruptible,
 * so the session either stays in the slot or is closed by whoever took it.
 */
export const makeReplacementSlot = Effect.fnUntraced(function* (
  connect: (
    entry: ConnectionCatalogEntry,
    reportProgress: (progress: Progress) => Effect.Effect<void>,
  ) => Effect.Effect<Lease, ConnectionAttemptError, Scope.Scope>,
) {
  const owner = yield* Effect.scope;
  const slot = yield* Ref.make(Option.none<Replacement>());

  const close = (replacement: Replacement, exit: Exit.Exit<unknown, unknown>) =>
    Fiber.interrupt(replacement.fiber).pipe(Effect.andThen(Scope.close(replacement.scope, exit)));

  const discard = Ref.getAndSet(slot, Option.none()).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.void,
        onSome: (replacement) => close(replacement, Exit.void),
      }),
    ),
    Effect.uninterruptible,
  );

  const start = Effect.fn("EnvironmentSupervisor.startReplacement")(function* (
    entry: ConnectionCatalogEntry,
  ) {
    yield* discard;
    const scope = yield* Scope.fork(owner);
    const progress = yield* SubscriptionRef.make<ReadonlyArray<Progress>>([]);
    const fiber = yield* Effect.forkIn(
      connect(entry, (next) => SubscriptionRef.update(progress, (seen) => [...seen, next])).pipe(
        Scope.provide(scope),
      ),
      owner,
    );
    yield* Ref.set(slot, Option.some({ scope, fiber, progress }));
    return fiber;
  }, Effect.uninterruptible);

  /**
   * Moves the replacement into the caller's scope and waits for it, replaying
   * its progress so the caller's state and setup budget match a fresh connect.
   */
  const adopt = Effect.fnUntraced(function* (
    reportProgress: (progress: Progress) => Effect.Effect<void>,
  ) {
    const taken = yield* Effect.acquireRelease(Ref.getAndSet(slot, Option.none()), (taken, exit) =>
      Option.isSome(taken) ? close(taken.value, exit) : Effect.void,
    );
    if (Option.isNone(taken)) return undefined;
    let replayed = 0;
    const replay = SubscriptionRef.changes(taken.value.progress).pipe(
      Stream.runForEach((seen) =>
        Effect.forEach(seen.slice(replayed), reportProgress, { discard: true }).pipe(
          Effect.andThen(
            Effect.sync(() => {
              replayed = seen.length;
            }),
          ),
        ),
      ),
    );
    const exit = yield* Effect.raceFirst(
      Fiber.await(taken.value.fiber),
      replay.pipe(Effect.andThen(Effect.never)),
    );
    return Exit.isSuccess(exit) ? exit.value : undefined;
  });

  return { start, adopt, discard };
});
