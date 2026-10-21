import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Socket from "effect/socket/Socket";

import { RelayGateway } from "@supaterm/client-runtime/relay";
import * as MobileRelayGateway from "./relayGateway";
import * as Effect from "effect/Effect";
import { layerRemoteHttpClient } from "@supaterm/client-runtime/rpc";

import * as Persistence from "../persistence/layer";
import { cryptoLayer } from "./crypto";
import { disposeOnFoundationReplace, type FoundationHotModule } from "./foundation-fast-refresh";
import { whenProtectedDataAvailable } from "./protectedData";

declare const module: { readonly hot?: FoundationHotModule } | undefined;

const layerHttpClient = Layer.unwrap(
  Effect.map(RelayGateway, (gateway) => layerRemoteHttpClient(gateway.fetch)),
);
const layerSocket = Socket.layerWebSocketConstructorGlobal;

type RuntimeLayerSource =
  | typeof layerSocket
  | typeof MobileRelayGateway.layer
  | typeof cryptoLayer
  | typeof layerHttpClient
  | typeof Persistence.layer;

const layerRuntime = layerSocket.pipe(
  Layer.provideMerge(cryptoLayer),
  Layer.provideMerge(layerHttpClient),
  Layer.provideMerge(Persistence.layer),
  Layer.provideMerge(MobileRelayGateway.layer),
  // These layers read the keychain and the database while they build, and a
  // failed build is kept for the life of the process.
  Layer.provide(Layer.effectDiscard(Effect.promise(whenProtectedDataAvailable))),
);

export const runtime: ManagedRuntime.ManagedRuntime<
  Layer.Success<RuntimeLayerSource>,
  Layer.Error<RuntimeLayerSource>
> = ManagedRuntime.make(layerRuntime);

export const layer: Layer.Layer<
  Layer.Success<RuntimeLayerSource>,
  Layer.Error<RuntimeLayerSource>
> = Layer.effectContext(runtime.contextEffect);

disposeOnFoundationReplace(typeof module === "undefined" ? undefined : module.hot, () =>
  runtime.dispose(),
);
