import type { ProviderInstanceId } from "@supaterm/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Semaphore from "effect/Semaphore";

interface InstanceGate {
  readonly turnstile: Semaphore.Semaphore;
  readonly room: Semaphore.Semaphore;
}

const ROOM_PERMITS = Number.MAX_SAFE_INTEGER;

export class ProviderInstallationGate extends Context.Service<
  ProviderInstallationGate,
  {
    /** Runs provider work once no update of the instance's installation is running or waiting. */
    readonly execute: <A, E, R>(
      instanceId: ProviderInstanceId,
      effect: Effect.Effect<A, E, R>,
    ) => Effect.Effect<A, E, R>;
    /** Runs an installation update after the instances' in-flight work, excluding new work. */
    readonly update: <A, E, R>(
      instanceIds: ReadonlyArray<ProviderInstanceId>,
      effect: Effect.Effect<A, E, R>,
    ) => Effect.Effect<A, E, R>;
  }
>()("supaterm/provider/ProviderInstallationGate") {}

export const layer = Layer.sync(ProviderInstallationGate, () => {
  const gates = new Map<ProviderInstanceId, InstanceGate>();
  const gateFor = (instanceId: ProviderInstanceId) =>
    Effect.sync(() => {
      const existing = gates.get(instanceId);
      if (existing) return existing;
      const gate = {
        turnstile: Semaphore.makeUnsafe(1),
        room: Semaphore.makeUnsafe(ROOM_PERMITS),
      };
      gates.set(instanceId, gate);
      return gate;
    });

  const execute = Effect.fn("ProviderInstallationGate.execute")(function* <A, E, R>(
    instanceId: ProviderInstanceId,
    effect: Effect.Effect<A, E, R>,
  ) {
    const gate = yield* gateFor(instanceId);
    yield* gate.turnstile.withPermits(1)(Effect.void);
    return yield* gate.room.withPermits(1)(effect);
  });

  const update = Effect.fn("ProviderInstallationGate.update")(function* <A, E, R>(
    instanceIds: ReadonlyArray<ProviderInstanceId>,
    effect: Effect.Effect<A, E, R>,
  ) {
    const instanceGates = yield* Effect.forEach(Array.from(new Set(instanceIds)).sort(), gateFor);
    const drained = instanceGates.reduceRight(
      (inner, gate) => gate.room.withPermits(ROOM_PERMITS)(inner),
      effect,
    );
    return yield* instanceGates.reduceRight(
      (inner, gate) => gate.turnstile.withPermits(1)(inner),
      drained,
    );
  });

  return ProviderInstallationGate.of({ execute, update });
});
