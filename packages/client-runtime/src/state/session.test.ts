import {
  type AuthSessionState,
  EnvironmentId,
  type ServerConfig,
  ORCHESTRATION_PROTOCOL_VERSION,
} from "@supaterm/contracts";
import { describe, expect, it } from "@effect/vitest";
import { relayHttpBaseUrl, relayPublicKey } from "@supaterm/shared/relay/protocol";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/http";
import { Atom, AtomRegistry } from "effect/reactivity";
import * as TestClock from "effect/testing/TestClock";

import { BearerConnectionProfile, type ConnectionRoute } from "../connection/catalog.ts";
import {
  AVAILABLE_CONNECTION_STATE,
  BearerConnectionTarget,
  SshConnectionTarget,
  type PreparedConnection,
} from "../connection/model.ts";
import * as EnvironmentRegistry from "../connection/registry.ts";
import * as EnvironmentSupervisor from "../connection/supervisor.ts";
import { layer as layerRelayGateway, RelayGateway, type RelayTransport } from "../relay/gateway.ts";
import type { WsRpcProtocolClient } from "../rpc/protocol.ts";
import type { RpcSession } from "../rpc/session.ts";
import { createEnvironmentSessionAtoms } from "./session.ts";

const environmentId = EnvironmentId.make("latency-state-test");
const descriptor = {
  environmentId,
  label: "Test",
  platform: { os: "linux", arch: "x64" },
  serverVersion: "0.0.0-test",
  orchestrationProtocolVersion: ORCHESTRATION_PROTOCOL_VERSION,
  capabilities: {},
};

function routeTo(id: string, httpBaseUrl: string): ConnectionRoute {
  return {
    target: new BearerConnectionTarget({ environmentId, connectionId: id, label: "Test" }),
    profile: Option.some(
      new BearerConnectionProfile({
        environmentId,
        connectionId: id,
        label: "Test",
        httpBaseUrl,
        wsBaseUrl: httpBaseUrl.replace(/^http/, "ws"),
      }),
    ),
  };
}

function directRoute(id: string): ConnectionRoute {
  return routeTo(id, `https://${id}.example.test/`);
}

const makeHarness = Effect.fn("RouteLatencyTest.makeHarness")(function* (options?: {
  readonly reply?: (url: string) => Effect.Effect<Response, "connection reset">;
  readonly activeRoute?: ConnectionRoute;
}) {
  const session: RpcSession = {
    client: {} as WsRpcProtocolClient,
    initialConfig: Effect.succeed({ environment: descriptor } as ServerConfig),
    configChanges: Stream.empty,
    subscribeServerConfig: () => Stream.never,
    ready: Effect.void,
    probe: Effect.sync(() => {
      probes += 1;
    }),
    closed: Effect.never,
  };
  let probes = 0;
  const supervisor = EnvironmentSupervisor.EnvironmentSupervisor.of({
    target: options?.activeRoute?.target ?? directRoute("lan").target,
    state: yield* SubscriptionRef.make(AVAILABLE_CONNECTION_STATE),
    session: yield* SubscriptionRef.make<Option.Option<RpcSession>>(
      options?.activeRoute === undefined ? Option.none() : Option.some(session),
    ),
    prepared: yield* SubscriptionRef.make<Option.Option<PreparedConnection>>(
      options?.activeRoute === undefined
        ? Option.none()
        : Option.some(prepared(options.activeRoute)),
    ),
    connect: Effect.die("Latency checks must not connect an environment"),
    disconnect: Effect.die("Latency checks must not disconnect an environment"),
    retryNow: Effect.die("Latency checks must not reconnect an environment"),
  });
  const environments = EnvironmentRegistry.EnvironmentRegistry.of({
    run: (_environmentId, effect) =>
      Effect.provideService(effect, EnvironmentSupervisor.EnvironmentSupervisor, supervisor),
    followStream: (_environmentId, stream) =>
      Stream.provideService(stream, EnvironmentSupervisor.EnvironmentSupervisor, supervisor),
  } as EnvironmentRegistry.EnvironmentRegistry["Service"]);
  const httpClient = HttpClient.make((request) =>
    (options?.reply?.(request.url) ?? Effect.succeed(Response.json(descriptor))).pipe(
      Effect.map((response) => HttpClientResponse.fromWeb(request, response)),
      Effect.mapError(
        (cause) =>
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.TransportError({ request, cause }),
          }),
      ),
    ),
  );
  const runtime = Atom.runtime(
    Layer.mergeAll(
      Layer.succeed(EnvironmentRegistry.EnvironmentRegistry, environments),
      Layer.succeed(HttpClient.HttpClient, httpClient),
      Layer.succeed(Clock.Clock, yield* Clock.Clock),
    ),
  );
  const atoms = createEnvironmentSessionAtoms(runtime);
  const registry = yield* Effect.acquireRelease(Effect.sync(AtomRegistry.make), (registry) =>
    Effect.sync(() => registry.dispose()),
  );
  return { atoms, registry, supervisor, probes: () => probes };
});

function prepared(route: ConnectionRoute): PreparedConnection {
  return {
    environmentId,
    label: "Test",
    httpBaseUrl: "http://127.0.0.1:4389/",
    socketUrl: "ws://127.0.0.1:4389/ws",
    httpAuthorization: null,
    target: route.target,
  };
}

describe("route latency state", () => {
  it.effect("shows each result without waiting on a slower route", () =>
    Effect.gen(function* () {
      const slowStarted = yield* Deferred.make<void>();
      const slowResponse = yield* Deferred.make<Response>();
      const { atoms, registry } = yield* makeHarness({
        reply: (url) =>
          url.includes("slow.example.test")
            ? Deferred.succeed(slowStarted, undefined).pipe(
                Effect.andThen(Deferred.await(slowResponse)),
              )
            : Effect.succeed(Response.json(descriptor)),
      });
      const slow = atoms.routeLatencyAtoms(directRoute("slow"));
      const fast = atoms.routeLatencyAtoms(directRoute("fast"));
      registry.mount(slow.labelAtom);
      registry.mount(fast.labelAtom);
      yield* Deferred.await(slowStarted);
      expect(registry.get(slow.labelAtom)).toBe("Checking…");
      expect(
        yield* AtomRegistry.getResult(registry, fast.resultAtom, { suspendOnWaiting: true }),
      ).toMatchObject({ status: "reachable" });
      expect(registry.get(fast.labelAtom)).toMatch(/^\d+ ms$/);
      expect(registry.get(slow.labelAtom)).toBe("Checking…");
      yield* Deferred.succeed(slowResponse, Response.json(descriptor));
      yield* AtomRegistry.getResult(registry, slow.resultAtom, { suspendOnWaiting: true });
      expect(registry.get(slow.labelAtom)).toMatch(/^\d+ ms$/);
    }),
  );

  it.effect("keeps a result across route reallocations and rechecks on refresh", () =>
    Effect.gen(function* () {
      let requests = 0;
      const { atoms, registry } = yield* makeHarness({
        reply: () =>
          Effect.sync(() => {
            requests += 1;
            return requests === 1 ? Response.json(descriptor) : new Response(null, { status: 503 });
          }),
      });
      const latency = atoms.routeLatencyAtoms(directRoute("lan"));
      registry.mount(latency.labelAtom);
      yield* AtomRegistry.getResult(registry, latency.resultAtom, { suspendOnWaiting: true });
      expect(registry.get(latency.labelAtom)).toMatch(/^\d+ ms$/);
      const reordered = atoms.routeLatencyAtoms(directRoute("lan"));
      yield* AtomRegistry.getResult(registry, reordered.resultAtom, { suspendOnWaiting: true });
      expect(requests).toBe(1);
      registry.refresh(reordered.resultAtom);
      yield* AtomRegistry.getResult(registry, latency.resultAtom, { suspendOnWaiting: true });
      expect(registry.get(latency.labelAtom)).toBe("Unreachable");
      expect(requests).toBe(2);
    }),
  );

  it.effect("measures only the active SSH route and updates when the route changes", () =>
    Effect.gen(function* () {
      const ssh: ConnectionRoute = {
        target: new SshConnectionTarget({ environmentId, connectionId: "ssh", label: "Test" }),
        profile: Option.none(),
      };
      const alternate: ConnectionRoute = {
        target: new SshConnectionTarget({
          environmentId,
          connectionId: "other-ssh",
          label: "Test",
        }),
        profile: Option.none(),
      };
      const { atoms, registry, supervisor, probes } = yield* makeHarness({
        activeRoute: ssh,
        reply: () => Effect.die("SSH latency must use the existing session"),
      });
      const active = atoms.routeLatencyAtoms(ssh);
      const inactive = atoms.routeLatencyAtoms(alternate);
      registry.mount(active.labelAtom);
      registry.mount(inactive.labelAtom);
      yield* AtomRegistry.toStream(registry, active.labelAtom).pipe(
        Stream.filter((label) => /^\d+ ms$/.test(label)),
        Stream.runHead,
      );
      expect(registry.get(inactive.labelAtom)).toBe("Not measured");
      expect(probes()).toBe(1);
      yield* SubscriptionRef.set(supervisor.prepared, Option.some(prepared(alternate)));
      yield* AtomRegistry.toStream(registry, inactive.labelAtom).pipe(
        Stream.filter((label) => /^\d+ ms$/.test(label)),
        Stream.runHead,
      );
      expect(registry.get(active.labelAtom)).toBe("Not measured");
      expect(probes()).toBe(2);
      yield* SubscriptionRef.set(supervisor.session, Option.none());
      yield* AtomRegistry.toStream(registry, inactive.labelAtom).pipe(
        Stream.filter((label) => label === "Not measured"),
        Stream.runHead,
      );
      expect(probes()).toBe(2);
    }),
  );
});

const grantedSession = {
  authenticated: true,
  auth: {
    policy: "remote-reachable",
    bootstrapMethods: ["one-time-token"],
    sessionMethods: ["bearer-access-token"],
    sessionCookieName: "supaterm_session",
  },
  scopes: ["orchestration:read", "orchestration:operate"],
} satisfies AuthSessionState;

describe("session state", () => {
  it.effect("retries an unreachable environment before settling its grants", () =>
    Effect.gen(function* () {
      const failed = yield* Deferred.make<void>();
      let requests = 0;
      const { atoms, registry, supervisor } = yield* makeHarness({
        reply: () =>
          Effect.suspend(() => {
            requests += 1;
            return requests === 1
              ? Deferred.succeed(failed, undefined).pipe(
                  Effect.andThen(Effect.fail("connection reset" as const)),
                )
              : Effect.succeed(Response.json(grantedSession));
          }),
      });
      const atom = atoms.sessionStateAtom(environmentId);
      registry.mount(atom);
      yield* SubscriptionRef.set(supervisor.prepared, Option.some(prepared(directRoute("lan"))));
      yield* Deferred.await(failed);
      yield* TestClock.adjust("1 second");
      expect(
        yield* AtomRegistry.getResult(registry, atom, { suspendOnWaiting: true }),
      ).toMatchObject({ scopes: grantedSession.scopes });
      expect(requests).toBe(2);
    }),
  );

  it.effect("settles on the failure once the retries run out", () =>
    Effect.gen(function* () {
      const failures = yield* Queue.unbounded<void>();
      const { atoms, registry, supervisor } = yield* makeHarness({
        reply: () =>
          Queue.offer(failures, undefined).pipe(
            Effect.andThen(Effect.fail("connection reset" as const)),
          ),
      });
      const atom = atoms.sessionStateAtom(environmentId);
      registry.mount(atom);
      yield* SubscriptionRef.set(supervisor.prepared, Option.some(prepared(directRoute("lan"))));
      for (const backoff of ["1 second", "2 seconds", "4 seconds"] as const) {
        yield* Queue.take(failures);
        yield* TestClock.adjust(backoff);
      }
      const result = yield* AtomRegistry.getResult(registry, atom, { suspendOnWaiting: true }).pipe(
        Effect.flip,
      );
      expect(result).toMatchObject({ _tag: "RemoteEnvironmentAuthFetchError" });
      expect(yield* Queue.size(failures)).toBe(1);
    }),
  );
});

describe("relay transport", () => {
  it.effect("follows the gateway's reports for a relay route until unmounted", () =>
    Effect.gen(function* () {
      const reports: Array<(via: RelayTransport | undefined) => void> = [];
      const gateway = Context.get(
        yield* Layer.build(
          layerRelayGateway({
            fetch,
            open: async (_address, _relayUrl, _directUrls, report) => {
              reports.push(report);
              return { prepare: async () => "http://127.0.0.1:3000", close: async () => {} };
            },
          }),
        ),
        RelayGateway,
      );
      let subscriptions = 0;
      const runtime = Atom.runtime(
        Layer.mergeAll(
          Layer.succeed(
            EnvironmentRegistry.EnvironmentRegistry,
            {} as EnvironmentRegistry.EnvironmentRegistry["Service"],
          ),
          Layer.succeed(RelayGateway, {
            ...gateway,
            subscribe: (listener) => {
              subscriptions++;
              const unsubscribe = gateway.subscribe(listener);
              return () => {
                subscriptions--;
                unsubscribe();
              };
            },
          }),
        ),
      );
      const atoms = createEnvironmentSessionAtoms(runtime);
      const tasks: Array<() => void> = [];
      const registry = yield* Effect.acquireRelease(
        Effect.sync(() =>
          AtomRegistry.make({
            scheduleTask: (task) => {
              tasks.push(task);
              return () => {};
            },
          }),
        ),
        (registry) => Effect.sync(() => registry.dispose()),
      );
      const relayAddress = relayHttpBaseUrl(relayPublicKey(new Uint8Array(32).fill(7)));
      const transport = atoms.relayRouteTransportAtom(routeTo("relay", relayAddress));
      const seen: Array<RelayTransport | undefined> = [];
      const unmount = registry.subscribe(transport, (value) => seen.push(value), {
        immediate: true,
      });
      registry.mount(atoms.relayRouteTransportAtom(directRoute("lan")));
      expect(subscriptions).toBe(1);

      yield* Effect.promise(() => gateway.resolve(relayAddress));
      reports[0]!("direct");
      reports[0]!("relay");
      yield* Effect.promise(() => gateway.release(relayAddress));
      expect(seen).toEqual([undefined, "direct", "relay", undefined]);

      unmount();
      for (let task = tasks.shift(); task !== undefined; task = tasks.shift()) task();
      expect(subscriptions).toBe(0);
    }),
  );
});
