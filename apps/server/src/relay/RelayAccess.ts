import {
  normalizeRelayServerUrl,
  relayAdvertisementFrom,
  RelayPreparationError,
  type RelayConnectionInfo,
  type RelayHostStatus,
  type ServerSettings,
} from "@supaterm/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Scope from "effect/Scope";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as ServerSettingsService from "../serverSettings.ts";
import * as RelayIdentity from "./RelayIdentity.ts";
import { RelayIngress } from "./RelayIngress.ts";
import { type RelayHostState as TransportState, startRelayTransport } from "./transport.ts";

const isRelayPreparationError = Schema.is(RelayPreparationError);

export class RelayAccess extends Context.Service<
  RelayAccess,
  {
    readonly start: Effect.Effect<void, never, Scope.Scope>;
    readonly prepare: Effect.Effect<RelayConnectionInfo, RelayPreparationError>;
    readonly status: Stream.Stream<RelayHostStatus>;
    readonly advertisements: Stream.Stream<RelayConnectionInfo | null>;
    readonly advertisement: Effect.Effect<Pick<RelayHostStatus, "relayEndpoint" | "relayUrl">>;
  }
>()("supaterm/relay/RelayAccess") {}

const make = Effect.gen(function* () {
  const identity = yield* RelayIdentity.RelayIdentity;
  const ingress = yield* RelayIngress;
  const settings = yield* ServerSettingsService.ServerSettingsService;
  const status = yield* SubscriptionRef.make<RelayHostStatus>({ state: "off" });
  const lock = yield* Semaphore.make(1);
  const runFork = Effect.runForkWith(yield* Effect.context<never>());
  let running:
    | { readonly relayUrl: string; readonly generation: object; readonly stop: () => void }
    | undefined;
  let started = false;
  let disposed = false;

  const stop = () => {
    const previous = running;
    running = undefined;
    previous?.stop();
  };
  const report = (state: TransportState, address: string, relayUrl: string, generation: object) => {
    if (state === "stopped") return;
    runFork(
      Effect.gen(function* () {
        if (running?.generation !== generation) return;
        if (state === "registered")
          yield* Effect.logInfo("Encrypted Relay registered", { relayUrl });
        if (state === "superseded")
          yield* Effect.logWarning(
            "Encrypted Relay identity is active on another host; reconnect is stopped.",
          );
        yield* SubscriptionRef.set(status, { state, relayEndpoint: address, relayUrl });
      }).pipe(lock.withPermit),
    );
  };
  const reconcile = Effect.fn("RelayAccess.reconcile")(
    function* (activate: boolean) {
      if (disposed) return yield* new RelayPreparationError({ reason: "unavailable" });
      const value = yield* settings.getSettings;
      const relayUrl = value.publicRelayEnabled
        ? normalizeRelayServerUrl(value.publicRelayUrl)
        : null;
      if (running !== undefined && running.relayUrl === relayUrl) return;
      stop();
      if (!value.publicRelayEnabled) return yield* SubscriptionRef.set(status, { state: "off" });
      if (relayUrl === null) return yield* SubscriptionRef.set(status, { state: "invalid-url" });
      const existing = yield* identity.existing;
      if (!activate && Option.isNone(existing))
        return yield* SubscriptionRef.set(status, { state: "idle" });
      const { secret, address } = Option.isSome(existing) ? existing.value : yield* identity.get;
      const generation = {};
      running = {
        relayUrl,
        generation,
        stop: startRelayTransport({
          secret,
          relayUrl,
          acceptStream: (stream) => ingress.accept(stream, { transport: "relay" }),
          onStatus: (state) => report(state, address, relayUrl, generation),
        }),
      };
      yield* SubscriptionRef.set(status, { state: "connecting", relayEndpoint: address, relayUrl });
    },
    lock.withPermit,
    Effect.mapError((cause) =>
      isRelayPreparationError(cause)
        ? cause
        : new RelayPreparationError({ reason: "unavailable", cause }),
    ),
  );
  const prepare = Effect.gen(function* () {
    yield* reconcile(true);
    return yield* SubscriptionRef.changes(status).pipe(
      Stream.filter((value) => value.state !== "connecting" && value.state !== "idle"),
      Stream.runHead,
      Effect.flatMap((result) => {
        if (Option.isNone(result))
          return Effect.fail(new RelayPreparationError({ reason: "unavailable" }));
        const value = result.value;
        if (
          value.state === "registered" &&
          value.relayEndpoint !== undefined &&
          value.relayUrl !== undefined
        )
          return Effect.succeed({ relayEndpoint: value.relayEndpoint, relayUrl: value.relayUrl });
        return Effect.fail(
          new RelayPreparationError({
            reason:
              value.state === "off" || value.state === "invalid-url" || value.state === "superseded"
                ? value.state
                : "unavailable",
          }),
        );
      }),
      Effect.timeoutOrElse({
        duration: "20 seconds",
        orElse: () => Effect.fail(new RelayPreparationError({ reason: "timeout" })),
      }),
    );
  });
  const start = Effect.gen(function* () {
    if (started) return;
    started = true;
    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        disposed = true;
        stop();
        yield* SubscriptionRef.set(status, { state: "off" });
      }).pipe(lock.withPermit),
    );
    const changes = yield* settings.subscribeChanges;
    const recover = Effect.catch((error: RelayPreparationError) =>
      Effect.logWarning("Encrypted Relay could not start", { error }).pipe(
        Effect.andThen(SubscriptionRef.set(status, { state: "off" })),
      ),
    );
    const refresh = Effect.fnUntraced(function* (value: ServerSettings) {
      if (!value.publicRelayEnabled)
        yield* Effect.gen(function* () {
          stop();
          yield* SubscriptionRef.set(status, { state: "off" });
        }).pipe(lock.withPermit);
      yield* reconcile(false);
    }, recover);
    yield* reconcile(false).pipe(recover);
    yield* changes.pipe(Stream.runForEach(refresh), Effect.forkScoped);
  });

  return RelayAccess.of({
    start,
    prepare,
    status: SubscriptionRef.changes(status),
    advertisements: SubscriptionRef.changes(status).pipe(
      Stream.map(relayAdvertisementFrom),
      Stream.changesWith<RelayConnectionInfo | null>(Equal.equals),
    ),
    advertisement: SubscriptionRef.get(status).pipe(
      Effect.map((value) => relayAdvertisementFrom(value) ?? {}),
    ),
  });
});

export const layer = Layer.effect(RelayAccess, make);
