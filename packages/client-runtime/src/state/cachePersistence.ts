import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import * as ConnectionWakeups from "../connection/wakeups.ts";

export const runCachePersistence = Effect.fn("runCachePersistence")(function* <A, E, R>(
  queue: Queue.Queue<A>,
  persist: (value: A) => Effect.Effect<void, E, R>,
) {
  const backgrounded = yield* Queue.sliding<void>(1);
  const wakeups = yield* Effect.serviceOption(ConnectionWakeups.ConnectionWakeups);
  if (Option.isSome(wakeups)) {
    yield* wakeups.value.changes.pipe(
      Stream.filter((reason) => reason === "application-background"),
      Stream.runForEach(() => Queue.offer(backgrounded, undefined)),
      Effect.forkScoped,
    );
  }
  const wait = (duration: `${number} millis` | `${number} seconds`) =>
    Queue.take(backgrounded).pipe(Effect.timeoutOrElse({ duration, orElse: () => Effect.void }));

  let next = yield* Queue.take(queue);
  yield* wait("500 millis");
  next = Option.getOrElse(yield* Queue.poll(queue), () => next);
  while (true) {
    yield* persist(next);
    yield* wait("10 seconds");
    next = yield* Queue.take(queue);
  }
});
