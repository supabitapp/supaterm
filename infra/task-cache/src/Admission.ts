import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Semaphore from "effect/Semaphore";

export class Admission extends Context.Service<
  Admission,
  {
    readonly withPermit: <A, E, R>(
      store: boolean,
      task: Effect.Effect<A, E, R>,
    ) => Effect.Effect<A, E, R>;
  }
>()("@supaterm/task-cache/Admission") {}

const make = Effect.gen(function* () {
  const stores = yield* Semaphore.make(2);
  const reads = yield* Semaphore.make(4);
  return Admission.of({
    withPermit: Effect.fnUntraced(function* (store, task) {
      return yield* (store ? stores : reads).withPermits(1)(task);
    }),
  });
});

export const layer = Layer.effect(Admission, make);
