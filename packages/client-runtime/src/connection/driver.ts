import * as Context from "effect/Context";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";
import * as HttpClient from "effect/http/HttpClient";

import type { ConnectionCatalogEntry, ConnectionRoute } from "./catalog.ts";
import type {
  ConnectionAttemptError,
  ConnectionAttemptStage,
  ConnectionTransientReason,
  PreparedConnection,
} from "./model.ts";
import { ConnectionTransientError } from "./model.ts";
import * as ConnectionResolver from "./resolver.ts";
import {
  connectionRoutes,
  routeEntry,
  routeHttpBaseUrl,
  sendsTokenInClear,
  usableRoutes,
} from "./routes.ts";
import * as RpcSession from "../rpc/session.ts";
import { fetchRemoteEnvironmentDescriptor } from "../environment/descriptor.ts";
import { leaseRelayOrigin } from "../relay/gateway.ts";

export type ConnectionDriverProgress =
  | {
      readonly stage: "preparing";
    }
  | {
      readonly stage: Exclude<ConnectionAttemptStage, "preparing">;
      readonly prepared: PreparedConnection;
    };

export interface EnvironmentConnectionLease {
  readonly prepared: PreparedConnection;
  readonly session: RpcSession.RpcSession;
}

export interface PreparedRoute {
  readonly route: ConnectionRoute;
  readonly prepared: PreparedConnection;
  readonly expiresAtNanos: bigint;
}

/**
 * The result of an unauthenticated reachability check. SSH routes have no
 * cheap check, so they are "unchecked".
 */
export type RouteCheck = "answered" | "silent" | "unchecked";

/** How long a route has to answer before it counts as unreachable from here. */
export const ROUTE_CHECK_TIMEOUT_MS = 2_500;
/** How long a connection attempt keeps listening for a route that missed the first check. */
export const LATE_ROUTE_CHECK_TIMEOUT_MS = 15_000;
/** How long a route has to resolve credentials and open its session. */
const ROUTE_SETUP_TIMEOUT_MS = 15_000;
/**
 * How long a route that opened its session waits for the first config
 * snapshot. A cold server with a large database can take longer than the
 * setup budget to answer, and that is not a reason to drop a working socket.
 */
export const ROUTE_SNAPSHOT_TIMEOUT_MS = 75_000;
const ROUTE_PREFERENCE_WAIT_MS = 250;
// Preferred routes share one head start, so a fallback does not wait the full
// check timeout for a LAN the device has already left. A route that misses it
// connects over a fallback, then upgrades with a later reconnect.
const ROUTE_CHECK_HEAD_START_MS = 500;
const PREFLIGHT_VALIDITY_NANOS = 10_000_000_000n;

export class ConnectionDriver extends Context.Service<
  ConnectionDriver,
  {
    readonly connect: (
      entry: ConnectionCatalogEntry,
      reportProgress: (progress: ConnectionDriverProgress) => Effect.Effect<void>,
      preflight?: PreparedRoute,
    ) => Effect.Effect<EnvironmentConnectionLease, ConnectionAttemptError, Scope.Scope>;
    /** Whether a route answers as the entry's environment, without credentials. */
    readonly checkRoute: (
      entry: ConnectionCatalogEntry,
      route: ConnectionRoute,
    ) => Effect.Effect<RouteCheck>;
    /**
     * Whether a route answers and accepts this client's credential,
     * without opening a socket. Switching to a route that fails this would
     * drop a working connection for nothing.
     */
    readonly preflight: (
      entry: ConnectionCatalogEntry,
      route: ConnectionRoute,
    ) => Effect.Effect<Option.Option<PreparedRoute>>;
  }
>()("@supaterm/client-runtime/connection/driver/ConnectionDriver") {}

/**
 * How well a failure explains why no route connected. A route whose host or
 * relay answered with a reason, such as an offline host, explains more than
 * one that never answered, and a transient failure is reported over a blocked
 * one so the connection keeps retrying.
 */
const TRANSIENT_FAILURE_RANK: Record<ConnectionTransientReason, number> = {
  network: 1,
  timeout: 1,
  transport: 1,
  "endpoint-unavailable": 2,
  "remote-unavailable": 2,
};
const failureRank = (failure: ConnectionAttemptError) =>
  failure._tag === "ConnectionBlockedError" ? 0 : TRANSIENT_FAILURE_RANK[failure.reason];

/** The origin that reaches a route's address from here, through a leased relay tunnel if it has one. */
export const leaseRouteOrigin = (route: ConnectionRoute, httpBaseUrl: string) => {
  const profile = Option.getOrNull(route.profile);
  const bearer = profile?._tag === "BearerConnectionProfile" ? profile : undefined;
  return leaseRelayOrigin(
    httpBaseUrl,
    bearer?.relayUrl,
    bearer === undefined ? undefined : (bearer.directTunnelUrls ?? []),
  ).pipe(Effect.map(({ origin }) => origin));
};

type CheckRoute = (route: ConnectionRoute) => Effect.Effect<RouteCheck, never, Scope.Scope>;
/** Resolves once the route's session is open; the driver then waits for its first snapshot. */
type ConnectRoute<R> = (
  route: ConnectionRoute,
) => Effect.Effect<EnvironmentConnectionLease, ConnectionAttemptError, R | Scope.Scope>;

export const connectOverRoutes = Effect.fn("ConnectionDriver.connectOverRoutes")(function* <R>(
  entry: ConnectionCatalogEntry,
  checkRoute: CheckRoute,
  connectRoute: ConnectRoute<R>,
) {
  // Checks, and the relay tunnels they lease, end with route selection.
  // Connecting over a relay resolves its origin, which retains its tunnel.
  const connectionScope = yield* Scope.Scope;
  return yield* selectAndConnect(entry, connectionScope, checkRoute, connectRoute).pipe(
    Effect.scoped,
  );
});

const selectAndConnect = Effect.fnUntraced(function* <R>(
  entry: ConnectionCatalogEntry,
  connectionScope: Scope.Scope,
  checkRoute: CheckRoute,
  connectRoute: ConnectRoute<R>,
) {
  const routes = usableRoutes(entry);
  const checks =
    routes.length === 1
      ? []
      : yield* Effect.forEach(routes, (route) => Effect.forkScoped(checkRoute(route)));
  const firstChecks = yield* Effect.forEach(checks, (check) =>
    Effect.forkScoped(Fiber.join(check).pipe(Effect.timeoutOption(ROUTE_CHECK_TIMEOUT_MS))),
  );
  const preferenceWindow = yield* Effect.forkScoped(
    (checks.length === 0
      ? Effect.never
      : Effect.raceAll(
          checks.map((check) =>
            Fiber.join(check).pipe(
              Effect.flatMap((result) => (result === "answered" ? Effect.void : Effect.never)),
            ),
          ),
        )
    ).pipe(
      Effect.andThen(Effect.sleep(ROUTE_PREFERENCE_WAIT_MS)),
      Effect.timeoutOrElse({ duration: ROUTE_CHECK_HEAD_START_MS, orElse: () => Effect.void }),
      Effect.as(Option.none<RouteCheck>()),
    ),
  );
  let failure: ConnectionAttemptError | undefined;
  // Each route gets its own scope so a half-open session closes before the next try.
  const attempt = Effect.fnUntraced(function* (route: ConnectionRoute) {
    const routeScope = yield* Scope.fork(connectionScope);
    const timeout = (duration: number) =>
      Effect.timeoutOrElse({
        duration,
        orElse: () =>
          Effect.fail(
            new ConnectionTransientError({
              reason: "timeout",
              detail: `${route.target.label} did not respond during connection setup.`,
            }),
          ),
      });
    const result = yield* connectRoute(route).pipe(
      timeout(ROUTE_SETUP_TIMEOUT_MS),
      Effect.tap((lease) => lease.session.ready.pipe(timeout(ROUTE_SNAPSHOT_TIMEOUT_MS))),
      Scope.provide(routeScope),
      Effect.onExit((exit) => (Exit.isSuccess(exit) ? Effect.void : Scope.close(routeScope, exit))),
      Effect.result,
    );
    if (result._tag === "Success") return Option.some(result.success);
    // An incompatible server is the same server on every route.
    if (result.failure.reason === "unsupported") return yield* result.failure;
    if (failure === undefined || failureRank(result.failure) > failureRank(failure))
      failure = result.failure;
    return Option.none();
  });
  const slow: Array<number> = [];
  const silent: Array<number> = [];
  for (const [index, route] of routes.entries()) {
    const check =
      firstChecks.length === 0
        ? Option.some<RouteCheck>("unchecked")
        : yield* Effect.raceFirst(Fiber.join(firstChecks[index]!), Fiber.join(preferenceWindow));
    if (Option.isNone(check)) {
      slow.push(index);
      continue;
    }
    if (check.value === "silent") {
      silent.push(index);
      continue;
    }
    const lease = yield* attempt(route);
    if (Option.isSome(lease)) return lease.value;
  }
  while (slow.length > 0) {
    const [index, check] = yield* Effect.raceAll(
      slow.map((index) =>
        Fiber.join(checks[index]!).pipe(Effect.map((check) => [index, check] as const)),
      ),
    );
    slow.splice(slow.indexOf(index), 1);
    if (check === "silent") {
      silent.push(index);
      continue;
    }
    const lease = yield* attempt(routes[index]!);
    if (Option.isSome(lease)) return lease.value;
  }
  for (const index of silent.sort((a, b) => a - b)) {
    const lease = yield* attempt(routes[index]!);
    if (Option.isSome(lease)) return lease.value;
  }
  return yield* (
    failure ??
      new ConnectionTransientError({
        reason: "endpoint-unavailable",
        detail: `${entry.target.label} did not answer on any saved route.`,
      })
  );
});

/** @public */
export const make = Effect.gen(function* () {
  const resolver = yield* ConnectionResolver.ConnectionResolver;
  const sessions = yield* RpcSession.RpcSessionFactory;
  const httpClient = yield* HttpClient.HttpClient;

  const checkRoute = (entry: ConnectionCatalogEntry, route: ConnectionRoute, timeoutMs: number) => {
    const httpBaseUrl = routeHttpBaseUrl(route);
    if (httpBaseUrl === null) return Effect.succeed<RouteCheck>("unchecked");
    // The descriptor is public, so this sends no credential to whatever
    // answers at a saved LAN address on a different network.
    return leaseRouteOrigin(route, httpBaseUrl).pipe(
      Effect.flatMap((resolved) =>
        fetchRemoteEnvironmentDescriptor({ httpBaseUrl: resolved, timeoutMs }),
      ),
      Effect.map((descriptor): RouteCheck =>
        descriptor.environmentId === entry.target.environmentId ? "answered" : "silent",
      ),
      Effect.timeoutOrElse({
        duration: timeoutMs,
        orElse: () => Effect.succeed<RouteCheck>("silent"),
      }),
      Effect.orElseSucceed((): RouteCheck => "silent"),
      Effect.provideService(HttpClient.HttpClient, httpClient),
      Effect.withSpan("ConnectionDriver.checkRoute", {
        attributes: { "connection.target.kind": route.target._tag },
      }),
    );
  };

  const connect = Effect.fn("ConnectionDriver.connect")(function* (
    entry: ConnectionCatalogEntry,
    reportProgress: (progress: ConnectionDriverProgress) => Effect.Effect<void>,
    preflight?: PreparedRoute,
  ) {
    const target = entry.target;
    yield* Effect.annotateCurrentSpan({
      "connection.environment.id": target.environmentId,
      "connection.target.kind": target._tag,
      "connection.route.count": connectionRoutes(entry).length,
    });
    yield* reportProgress({ stage: "preparing" });
    const freshPreflight =
      preflight !== undefined && preflight.expiresAtNanos > (yield* Clock.monotonicTimeNanos)
        ? preflight
        : undefined;
    const preparationFor = (route: ConnectionRoute) =>
      freshPreflight !== undefined && Equal.equals(freshPreflight.route, route)
        ? freshPreflight
        : undefined;
    return yield* connectOverRoutes(
      entry,
      (route) =>
        preparationFor(route) !== undefined
          ? Effect.succeed<RouteCheck>("answered")
          : checkRoute(entry, route, LATE_ROUTE_CHECK_TIMEOUT_MS),
      Effect.fnUntraced(function* (route) {
        const cached = preparationFor(route);
        const prepared =
          cached !== undefined && cached.expiresAtNanos > (yield* Clock.monotonicTimeNanos)
            ? cached.prepared
            : yield* resolver.prepare(routeEntry(entry, route));
        yield* reportProgress({ stage: "opening", prepared });
        const session = yield* sessions.connect(prepared);
        yield* reportProgress({ stage: "synchronizing", prepared });
        return { prepared, session } satisfies EnvironmentConnectionLease;
      }),
    );
  });

  const preflight = (entry: ConnectionCatalogEntry, route: ConnectionRoute) =>
    (sendsTokenInClear(connectionRoutes(entry), route)
      ? Effect.succeed("silent" as const)
      : checkRoute(entry, route, ROUTE_CHECK_TIMEOUT_MS)
    ).pipe(
      Effect.flatMap((check) =>
        check === "answered"
          ? Effect.gen(function* () {
              const expiresAtNanos = (yield* Clock.monotonicTimeNanos) + PREFLIGHT_VALIDITY_NANOS;
              const prepared = yield* resolver.prepare(routeEntry(entry, route));
              return Option.some({ route, prepared, expiresAtNanos });
            }).pipe(Effect.orElseSucceed(() => Option.none<PreparedRoute>()))
          : Effect.succeedNone,
      ),
      Effect.scoped,
      Effect.withSpan("ConnectionDriver.preflight"),
    );

  return ConnectionDriver.of({
    connect,
    checkRoute: (entry, route) => Effect.scoped(checkRoute(entry, route, ROUTE_CHECK_TIMEOUT_MS)),
    preflight,
  });
});

export const layer = Layer.effect(ConnectionDriver, make);
