import { EnvironmentId, ORCHESTRATION_PROTOCOL_VERSION } from "@supaterm/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import * as RemoteEnvironmentAuthorization from "../authorization/service.ts";
import * as ClientCapabilities from "../platform/capabilities.ts";
import * as RelayGateway from "../relay/gateway.ts";
import { layerRemoteHttpClient } from "../rpc/http.ts";
import * as RpcSession from "../rpc/session.ts";
import {
  BearerConnectionCredential,
  BearerConnectionProfile,
  type ConnectionRoute,
} from "./catalog.ts";
import * as ConnectionCredentialStore from "./credentialStore.ts";
import * as ConnectionDriver from "./driver.ts";
import { BearerConnectionTarget } from "./model.ts";
import * as ConnectionProfileStore from "./profileStore.ts";
import * as ConnectionResolver from "./resolver.ts";

const environmentId = EnvironmentId.make("relay-driver-test");
const relayAddress = `https://${"11".repeat(16)}.${"22".repeat(16)}.relay.supaterm.alt/`;
const tunnelOrigin = "http://127.0.0.1:49000";

function bearerRoute(connectionId: string, httpBaseUrl: string): ConnectionRoute {
  const target = new BearerConnectionTarget({ environmentId, connectionId, label: "Test" });
  return {
    target,
    profile: Option.some(
      new BearerConnectionProfile({
        environmentId,
        connectionId,
        label: "Test",
        httpBaseUrl,
        wsBaseUrl: httpBaseUrl.replace(/^http/, "ws"),
      }),
    ),
  };
}
const lan = bearerRoute("lan", "http://192.168.1.2:4389/");
const relay = bearerRoute("relay", relayAddress);

const connectWithRealResolver = Effect.fnUntraced(function* (
  lanAnswers: (relayOpened: Promise<void>) => Promise<boolean>,
  directTunnelUrls?: ReadonlyArray<string>,
) {
  let opens = 0;
  const offered: Array<ReadonlyArray<string>> = [];
  const relayProfile = Option.getOrThrow(relay.profile);
  const relayRoute: ConnectionRoute =
    directTunnelUrls === undefined || relayProfile._tag !== "BearerConnectionProfile"
      ? relay
      : {
          target: relay.target,
          profile: Option.some(new BearerConnectionProfile({ ...relayProfile, directTunnelUrls })),
        };
  const relayOpened = Promise.withResolvers<void>();
  const lanAnswered = lanAnswers(relayOpened.promise);
  const descriptor = {
    environmentId,
    label: "Test",
    platform: { os: "linux", arch: "x64" },
    serverVersion: "0.0.0-test",
    orchestrationProtocolVersion: ORCHESTRATION_PROTOCOL_VERSION,
    capabilities: {},
  };
  const dependencies = Layer.mergeAll(
    layerRemoteHttpClient(async (request) => {
      if (String(request).startsWith(tunnelOrigin)) return Response.json(descriptor);
      if (await lanAnswered) return Response.json(descriptor);
      throw new TypeError("Network unreachable");
    }),
    RelayGateway.layer({
      fetch,
      open: async (_address, _relayUrl, directUrls) => {
        opens++;
        offered.push(directUrls());
        relayOpened.resolve();
        return {
          prepare: async () => tunnelOrigin,
          close: async () => {},
        };
      },
    }),
    Layer.succeed(
      ConnectionCredentialStore.ConnectionCredentialStore,
      ConnectionCredentialStore.ConnectionCredentialStore.of({
        get: () => Effect.succeed(Option.some(new BearerConnectionCredential({ token: "t" }))),
        put: () => Effect.void,
        remove: () => Effect.void,
      }),
    ),
    Layer.succeed(
      ConnectionProfileStore.ConnectionProfileStore,
      ConnectionProfileStore.ConnectionProfileStore.of({
        get: () => Effect.succeedNone,
        put: () => Effect.void,
        remove: () => Effect.void,
      }),
    ),
    Layer.succeed(
      ClientCapabilities.PrimaryEnvironmentAuth,
      ClientCapabilities.PrimaryEnvironmentAuth.of({ bearerToken: Effect.succeedNone }),
    ),
    Layer.succeed(
      ClientCapabilities.ClientPresentation,
      ClientCapabilities.ClientPresentation.of({
        metadata: { label: "Test", deviceType: "mobile", surface: "mobile" },
      }),
    ),
    Layer.succeed(
      ClientCapabilities.SshEnvironmentGateway,
      ClientCapabilities.SshEnvironmentGateway.of({
        provision: () => Effect.die("unused"),
        prepare: () => Effect.die("unused"),
        disconnect: () => Effect.void,
      }),
    ),
    Layer.succeed(
      RemoteEnvironmentAuthorization.RemoteEnvironmentAuthorization,
      RemoteEnvironmentAuthorization.RemoteEnvironmentAuthorization.of({
        authorizeBearer: (input) =>
          Effect.succeed({
            environmentId: input.expectedEnvironmentId,
            label: "Test",
            httpBaseUrl: input.httpBaseUrl,
            socketUrl: `${input.wsBaseUrl}ws`,
            httpAuthorization: { _tag: "Bearer" as const, token: input.bearerToken },
          }),
      }),
    ),
    Layer.succeed(
      RpcSession.RpcSessionFactory,
      RpcSession.RpcSessionFactory.of({
        connect: () =>
          Effect.succeed({
            client: {} as RpcSession.RpcSession["client"],
            initialConfig: Effect.die("unused"),
            configChanges: Stream.never,
            subscribeServerConfig: () => Stream.empty,
            ready: Effect.void,
            probe: Effect.void,
            inboundFrames: Effect.succeed(0),
            closed: Effect.never,
          } satisfies RpcSession.RpcSession),
      }),
    ),
  );
  return yield* Effect.gen(function* () {
    const driver = yield* ConnectionDriver.make;
    const lease = yield* driver.connect(
      { ...lan, enabled: true, alternateRoutes: [relayRoute] },
      () => Effect.void,
    );
    const gateway = yield* RelayGateway.RelayGateway;
    // A tunnel released when selection ended has to be opened again.
    yield* Effect.promise(() => gateway.resolve(relayAddress));
    return { target: lease.prepared.target, opens, offered };
  }).pipe(
    Effect.provide(ConnectionResolver.layer.pipe(Layer.provideMerge(dependencies))),
    Effect.scoped,
  );
});

describe("relay route checks with the real resolver and gateway", () => {
  it.effect("keeps the tunnel a winning relay connection uses", () =>
    Effect.gen(function* () {
      const result = yield* connectWithRealResolver(async () => false);
      expect(result.target).toEqual(relay.target);
      expect(result.opens).toBe(1);
    }),
  );

  it.effect("releases the tunnel a relay check opened when a direct route wins", () =>
    Effect.gen(function* () {
      const result = yield* connectWithRealResolver((relayOpened) => relayOpened.then(() => true));
      expect(result.target).toEqual(lan.target);
      expect(result.opens).toBe(2);
    }),
  );

  it.effect("offers the gateway the relay route's direct tunnel candidates", () =>
    Effect.gen(function* () {
      const urls = ["ws://192.168.1.2:4390", "ws://100.101.102.103:4390"];
      const result = yield* connectWithRealResolver(async () => false, urls);
      expect(result.target).toEqual(relay.target);
      expect(result.offered).toEqual([urls]);
    }),
  );
});
