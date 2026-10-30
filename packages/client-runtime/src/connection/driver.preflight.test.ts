import { EnvironmentId, ORCHESTRATION_PROTOCOL_VERSION } from "@supaterm/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient, HttpClientResponse } from "effect/http";
import * as FetchHttpClient from "effect/http/FetchHttpClient";

import {
  BearerConnectionProfile,
  type ConnectionCatalogEntry,
  type ConnectionRoute,
} from "./catalog.ts";
import * as ConnectionDriver from "./driver.ts";
import * as ConnectionResolver from "./resolver.ts";
import { BearerConnectionTarget, type PreparedConnection } from "./model.ts";
import { connectionRouteId } from "./routes.ts";
import * as RpcSession from "../rpc/session.ts";

const target = new BearerConnectionTarget({
  environmentId: EnvironmentId.make("preflight-test"),
  connectionId: "lan",
  label: "Test",
});
const profile = new BearerConnectionProfile({
  environmentId: target.environmentId,
  connectionId: target.connectionId,
  label: target.label,
  httpBaseUrl: "http://192.168.1.2:4389/",
  wsBaseUrl: "ws://192.168.1.2:4389/",
});
const route: ConnectionRoute = { target, profile: Option.some(profile) };
const entry: ConnectionCatalogEntry = { ...route, enabled: true };

const makeHarness = Effect.fnUntraced(function* () {
  const prepares = yield* Ref.make(0);
  const prepared = yield* Ref.make<ReadonlyArray<string>>([]);
  const checks = yield* Ref.make(0);
  const cacheModes = yield* Ref.make<ReadonlyArray<RequestCache | undefined>>([]);
  const authorizationHeaders = yield* Ref.make<ReadonlyArray<string | undefined>>([]);
  const requested = yield* Ref.make<ReadonlyArray<string>>([]);
  const connections = yield* Ref.make<ReadonlyArray<PreparedConnection>>([]);
  const resolver = ConnectionResolver.ConnectionResolver.of({
    prepare: (entry) =>
      Ref.update(prepared, (ids) => [...ids, connectionRouteId(entry.target)]).pipe(
        Effect.andThen(Ref.updateAndGet(prepares, (count) => count + 1)),
        Effect.map(
          (count) =>
            ({
              environmentId: entry.target.environmentId,
              label: entry.target.label,
              target: entry.target,
              httpBaseUrl: profile.httpBaseUrl,
              socketUrl: `${profile.wsBaseUrl}ws?wsTicket=ticket-${count}`,
              httpAuthorization: { _tag: "Bearer", token: "test-token" },
            }) satisfies PreparedConnection,
        ),
      ),
    prepareForUpdate: () => Effect.die("Update preparation is not used by these tests"),
  });
  const factory = RpcSession.RpcSessionFactory.of({
    connect: (prepared) =>
      Ref.update(connections, (current) => [...current, prepared]).pipe(
        Effect.as({
          client: {} as RpcSession.RpcSession["client"],
          initialConfig: Effect.die("Config is not used by these tests"),
          configChanges: Stream.never,
          subscribeServerConfig: () => Stream.empty,
          ready: Effect.void,
          probe: Effect.void,
          inboundFrames: Effect.succeed(0),
          closed: Effect.never,
        } satisfies RpcSession.RpcSession),
      ),
  });
  const client = HttpClient.make((request) =>
    Effect.gen(function* () {
      const init = yield* FetchHttpClient.RequestInit;
      yield* Ref.update(cacheModes, (modes) => [...modes, init.cache]);
      yield* Ref.update(authorizationHeaders, (headers) => [
        ...headers,
        request.headers.authorization,
      ]);
      return yield* Ref.update(checks, (count) => count + 1).pipe(
        Effect.andThen(Ref.update(requested, (urls) => [...urls, request.url])),
        Effect.as(
          HttpClientResponse.fromWeb(
            request,
            Response.json({
              environmentId: target.environmentId,
              label: target.label,
              platform: { os: "linux", arch: "x64" },
              serverVersion: "0.0.0-test",
              orchestrationProtocolVersion: ORCHESTRATION_PROTOCOL_VERSION,
              capabilities: {},
            }),
          ),
        ),
      );
    }),
  );
  const driver = yield* ConnectionDriver.make.pipe(
    Effect.provideService(ConnectionResolver.ConnectionResolver, resolver),
    Effect.provideService(RpcSession.RpcSessionFactory, factory),
    Effect.provideService(HttpClient.HttpClient, client),
  );
  return {
    driver,
    prepares,
    prepared,
    checks,
    requested,
    connections,
    cacheModes,
    authorizationHeaders,
  };
});

describe("route preflight preparation", () => {
  it.effect("checks the live session origin without cached responses or credentials", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const prepared: PreparedConnection = {
        environmentId: target.environmentId,
        label: target.label,
        target,
        httpBaseUrl: "http://127.0.0.1:4390/",
        socketUrl: "ws://127.0.0.1:4390/ws",
        httpAuthorization: { _tag: "Bearer", token: "session-secret" },
        connectionMethod: "relay",
      };
      expect(yield* harness.driver.checkHost(prepared)).toBe("answered");
      expect(yield* harness.driver.checkHost(prepared)).toBe("answered");
      expect(yield* Ref.get(harness.requested)).toEqual([
        "http://127.0.0.1:4390/.well-known/supaterm/environment",
        "http://127.0.0.1:4390/.well-known/supaterm/environment",
      ]);
      expect(yield* Ref.get(harness.cacheModes)).toEqual(["no-store", "no-store"]);
      expect(yield* Ref.get(harness.authorizationHeaders)).toEqual([undefined, undefined]);
    }),
  );

  it.effect(
    "opens a socket using fresh preparation without repeating HTTP checks or authentication",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeHarness();
        const result = yield* harness.driver.preflight(entry, route);
        if (result._tag !== "ready") throw new Error("Expected a prepared route");
        const preflight = result.prepared;
        expect(yield* Ref.get(harness.connections)).toEqual([]);
        const lease = yield* harness.driver.connect(entry, () => Effect.void, preflight);
        expect(lease.prepared).toBe(preflight.prepared);
        expect(yield* Ref.get(harness.prepares)).toBe(1);
        expect(yield* Ref.get(harness.checks)).toBe(1);
        expect(yield* Ref.get(harness.connections)).toEqual([preflight.prepared]);
      }),
  );

  it.effect("renews expired preparation before opening a socket", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const result = yield* harness.driver.preflight(entry, route);
      if (result._tag !== "ready") throw new Error("Expected a prepared route");
      const preflight = result.prepared;
      yield* TestClock.adjust("10 seconds");
      const lease = yield* harness.driver.connect(entry, () => Effect.void, preflight);
      expect(lease.prepared.socketUrl).toContain("ticket-2");
      expect(yield* Ref.get(harness.prepares)).toBe(2);
      expect(yield* Ref.get(harness.connections)).toHaveLength(1);
    }),
  );

  it.effect("prepares again when a route with the same ID changes address", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const result = yield* harness.driver.preflight(entry, route);
      if (result._tag !== "ready") throw new Error("Expected a prepared route");
      const preflight = result.prepared;
      const changed: ConnectionCatalogEntry = {
        ...entry,
        profile: Option.some(
          new BearerConnectionProfile({
            ...profile,
            httpBaseUrl: "http://192.168.2.2:4389/",
            wsBaseUrl: "ws://192.168.2.2:4389/",
          }),
        ),
      };
      const lease = yield* harness.driver.connect(changed, () => Effect.void, preflight);
      expect(lease.prepared.socketUrl).toContain("ticket-2");
      expect(yield* Ref.get(harness.prepares)).toBe(2);
      expect(yield* Ref.get(harness.connections)).toHaveLength(1);
    }),
  );

  it.effect("sends a relay-paired token to no plain HTTP route it learned", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const relayAddress = `https://${"11".repeat(16)}.${"22".repeat(16)}.relay.supaterm.alt/`;
      const relayTarget = new BearerConnectionTarget({ ...target, connectionId: "relay" });
      const relay: ConnectionRoute = {
        target: relayTarget,
        profile: Option.some(
          new BearerConnectionProfile({
            ...profile,
            connectionId: "relay",
            httpBaseUrl: relayAddress,
            wsBaseUrl: relayAddress.replace("https:", "wss:"),
          }),
        ),
      };
      const learnedId = `learned:${target.environmentId}:http://192.168.1.2:4389@relay`;
      const learned: ConnectionRoute = {
        target: new BearerConnectionTarget({ ...target, connectionId: learnedId }),
        profile: Option.some(
          new BearerConnectionProfile({ ...profile, connectionId: learnedId, learned: true }),
        ),
      };
      const both: ConnectionCatalogEntry = { ...learned, enabled: true, alternateRoutes: [relay] };
      expect(yield* harness.driver.preflight(both, learned)).toEqual({ _tag: "silent" });
      const lease = yield* harness.driver.connect(both, () => Effect.void);
      expect(lease.prepared.target).toEqual(relayTarget);
      expect(yield* Ref.get(harness.prepared)).toEqual(["relay"]);
      expect((yield* Ref.get(harness.requested)).filter((url) => url.startsWith("http:"))).toEqual(
        [],
      );
    }),
  );
});
