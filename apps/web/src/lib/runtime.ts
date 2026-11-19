import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Socket from "effect/socket/Socket";

import { RelayGateway } from "@supaterm/client-runtime/relay";
import * as WebRelayGateway from "./relayGateway";
import { layerRemoteHttpClient } from "@supaterm/client-runtime/rpc";
import * as PrimaryEnvironmentHttpClient from "../environments/primary/httpClient";
import * as PrimaryEnvironmentHttpLayer from "../environments/primary/httpLayer";
import * as ClientTracer from "../observability/clientTracer";
import { browserCryptoLayer } from "./browserCrypto";

const layerHttpClient = Layer.unwrap(
  Effect.map(RelayGateway, (gateway) => layerRemoteHttpClient(gateway.fetch)),
);
const layerSocket = Socket.layerWebSocketConstructorGlobal;

type RuntimeLayerSource =
  | typeof layerHttpClient
  | typeof browserCryptoLayer
  | typeof layerSocket
  | typeof WebRelayGateway.layer
  | typeof ClientTracer.layer;

const primaryHttpRuntime = ManagedRuntime.make(
  PrimaryEnvironmentHttpClient.layer.pipe(Layer.provide(PrimaryEnvironmentHttpLayer.layer)),
);

export type PrimaryHttpEffectRunner = <A, E>(
  effect: Effect.Effect<A, E, PrimaryEnvironmentHttpClient.PrimaryEnvironmentHttpClient>,
) => Promise<A>;

const livePrimaryHttpRunner: PrimaryHttpEffectRunner = (effect) =>
  primaryHttpRuntime.runPromise(effect);

let primaryHttpRunner = livePrimaryHttpRunner;

export const runPrimaryHttp = <A, E>(
  effect: Effect.Effect<A, E, PrimaryEnvironmentHttpClient.PrimaryEnvironmentHttpClient>,
) => primaryHttpRunner(effect);

export function __setPrimaryHttpRunnerForTests(runner?: PrimaryHttpEffectRunner): void {
  primaryHttpRunner = runner ?? livePrimaryHttpRunner;
}

const layerRuntime = Layer.mergeAll(
  layerHttpClient,
  browserCryptoLayer,
  layerSocket,
  ClientTracer.layer,
).pipe(Layer.provideMerge(WebRelayGateway.layer));

const runtime: ManagedRuntime.ManagedRuntime<
  Layer.Success<RuntimeLayerSource>,
  Layer.Error<RuntimeLayerSource>
> = ManagedRuntime.make(layerRuntime);

export const layer: Layer.Layer<
  Layer.Success<RuntimeLayerSource>,
  Layer.Error<RuntimeLayerSource>
> = Layer.effectContext(runtime.contextEffect);
