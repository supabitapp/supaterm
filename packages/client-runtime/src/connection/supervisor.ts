import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Random from "effect/Random";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import type { ConnectionCatalogEntry, ConnectionRoute } from "./catalog.ts";
import * as Connectivity from "./connectivity.ts";
import * as ConnectionDriver from "./driver.ts";
import {
  type ConnectionAttemptError,
  type ConnectionTarget,
  ConnectionTransientError,
  type NetworkStatus,
  type PreparedConnection,
  type SupervisorConnectionState,
} from "./model.ts";
import * as RpcSession from "../rpc/session.ts";
import { safeErrorLogAttributes } from "../errors/safeLog.ts";
import * as ConnectionWakeups from "./wakeups.ts";
import {
  advertisedConnectionRoutes,
  type ConnectionRouteAdvertisements,
  connectionRouteId,
  connectionRouteKind,
  connectionRoutes,
  entryWithRoutes,
} from "./routes.ts";

const RETRY_BASE_DELAY_MS = 1_000;
const RETRY_MAX_DELAY_MS = 30_000;
// A cold server with a large database can take longer than 15 seconds to
// answer, and that is not a reason to drop a working connection.
const CONNECTION_ESTABLISHMENT_TIMEOUT = "15 seconds";
const synchronizationTimeout = Duration.millis(ConnectionDriver.ROUTE_SNAPSHOT_TIMEOUT_MS);
const CONNECTION_PROBE_TIMEOUT = "15 seconds";
const QUICK_CONNECTION_PROBE_TIMEOUT = "3 seconds";
const BACKOFF_RESET_AFTER_MS = 30_000;
const BETTER_ROUTE_CHECK_INTERVAL = "60 seconds";
const BETTER_ROUTE_COOLDOWN_MS = 300_000;

interface SupervisorIntent {
  readonly desired: boolean;
  readonly network: NetworkStatus;
  readonly backgrounded: boolean;
}

type SupervisorSignal =
  | { readonly _tag: "ConnectRequested" }
  | { readonly _tag: "DisconnectRequested" }
  | { readonly _tag: "RetryRequested" }
  | { readonly _tag: "NetworkChanged"; readonly network: NetworkStatus }
  | { readonly _tag: "Wakeup"; readonly reason: ConnectionWakeups.ConnectionWakeup }
  | { readonly _tag: "BetterRouteAvailable"; readonly preflight: ConnectionDriver.PreparedRoute };

type AttemptOutcome =
  | {
      readonly _tag: "Interrupted";
      readonly established: boolean;
      readonly stable: boolean;
      readonly resetRetry: boolean;
    }
  | {
      readonly _tag: "Failure";
      readonly established: boolean;
      readonly stable: boolean;
      readonly error: ConnectionAttemptError;
    };

type EstablishmentEvent =
  | {
      readonly _tag: "Completed";
      readonly exit: Exit.Exit<ConnectionDriver.EnvironmentConnectionLease, ConnectionAttemptError>;
    }
  | { readonly _tag: "Interrupted"; readonly resetRetry: boolean }
  | { readonly _tag: "TimedOut" };

function exitUnlessInterrupted<A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<Exit.Exit<A, E>, never, R> {
  return Effect.matchCauseEffect(effect, {
    onFailure: (cause) =>
      Cause.hasInterrupts(cause) ? Effect.interrupt : Effect.succeed(Exit.failCause(cause)),
    onSuccess: (value) => Effect.succeed(Exit.succeed(value)),
  });
}

export interface EnvironmentSupervisorOptions {
  readonly initiallyDesired?: boolean;
  readonly entryRef?: Ref.Ref<ConnectionCatalogEntry>;
  readonly learnRoutes?: (
    input: {
      readonly activeRoute: ConnectionRoute;
      readonly sourceSession: RpcSession.RpcSession;
    } & ConnectionRouteAdvertisements,
  ) => Effect.Effect<Option.Option<ConnectionCatalogEntry>>;
}

export function retryDelayMs(failureCount: number, random: number): number {
  const ceiling = Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * 2 ** (failureCount + 1));
  return Math.round(ceiling / 2 + (ceiling / 2) * random);
}

function annotateTarget(target: ConnectionTarget) {
  return Effect.annotateCurrentSpan({
    "environment.id": target.environmentId,
    "environment.label": target.label,
    "environment.target.kind": target._tag,
  });
}

function availableState(intent: SupervisorIntent, generation: number): SupervisorConnectionState {
  return {
    desired: false,
    network: intent.network,
    phase: "available",
    stage: null,
    attempt: 0,
    generation,
    lastFailure: null,
    retryAt: null,
  };
}

function offlineState(
  intent: SupervisorIntent,
  generation: number,
  attempt: number,
  lastFailure: ConnectionAttemptError | null,
): SupervisorConnectionState {
  return {
    desired: true,
    network: intent.network,
    phase: "offline",
    stage: null,
    attempt,
    generation,
    lastFailure,
    retryAt: null,
  };
}

function connectingState(
  intent: SupervisorIntent,
  generation: number,
  attempt: number,
  lastFailure: ConnectionAttemptError | null,
  stage: SupervisorConnectionState["stage"] = "preparing",
): SupervisorConnectionState {
  return {
    desired: true,
    network: intent.network,
    phase: "connecting",
    stage,
    attempt,
    generation,
    lastFailure,
    retryAt: null,
  };
}

function failureFromExit<A>(
  target: ConnectionTarget,
  exit: Exit.Exit<A, ConnectionAttemptError>,
  established: boolean,
  stable: boolean,
): AttemptOutcome {
  if (Exit.isSuccess(exit) || Cause.hasInterruptsOnly(exit.cause)) {
    return { _tag: "Interrupted", established, stable, resetRetry: false };
  }
  const typedFailure = exit.cause.reasons.find(Cause.isFailReason);
  if (typedFailure) {
    return {
      _tag: "Failure",
      established,
      stable,
      error: typedFailure.error,
    };
  }
  return {
    _tag: "Failure",
    established,
    stable,
    error: new ConnectionTransientError({
      reason: "transport",
      detail: `${target.label} connection failed unexpectedly.`,
    }),
  };
}

export class EnvironmentSupervisor extends Context.Service<
  EnvironmentSupervisor,
  {
    readonly target: ConnectionTarget;
    readonly state: SubscriptionRef.SubscriptionRef<SupervisorConnectionState>;
    readonly session: SubscriptionRef.SubscriptionRef<Option.Option<RpcSession.RpcSession>>;
    readonly prepared: SubscriptionRef.SubscriptionRef<Option.Option<PreparedConnection>>;
    readonly connect: Effect.Effect<void>;
    readonly disconnect: Effect.Effect<void>;
    readonly retryNow: Effect.Effect<void>;
  }
>()("@supaterm/client-runtime/connection/supervisor/EnvironmentSupervisor") {}

export const make = Effect.fn("EnvironmentSupervisor.make")(function* (
  entry: ConnectionCatalogEntry,
  options?: EnvironmentSupervisorOptions,
): Effect.fn.Return<
  EnvironmentSupervisor["Service"],
  never,
  | Connectivity.Connectivity
  | ConnectionDriver.ConnectionDriver
  | Scope.Scope
  | ConnectionWakeups.ConnectionWakeups
> {
  const target = entry.target;
  const setupTimeoutDetail = `${target.label} did not respond during connection setup.`;
  yield* annotateTarget(target);

  const connectivity = yield* Connectivity.Connectivity;
  const driver = yield* ConnectionDriver.ConnectionDriver;
  const wakeups = yield* ConnectionWakeups.ConnectionWakeups;
  const initialIntent: SupervisorIntent = {
    desired: options?.initiallyDesired ?? false,
    network: yield* connectivity.status,
    backgrounded: yield* wakeups.isBackgrounded ?? Effect.succeed(false),
  };
  const intent = yield* Ref.make(initialIntent);
  const signals = yield* Queue.unbounded<SupervisorSignal>();
  const resetRetryState = yield* Ref.make(false);
  const pendingProbe = yield* Ref.make<"idle" | "checking" | "mobile-resume">("idle");
  const state = yield* SubscriptionRef.make<SupervisorConnectionState>(
    !initialIntent.desired
      ? availableState(initialIntent, 0)
      : initialIntent.network === "offline"
        ? offlineState(initialIntent, 0, 0, null)
        : connectingState(initialIntent, 0, 1, null),
  );
  const session = yield* SubscriptionRef.make<Option.Option<RpcSession.RpcSession>>(Option.none());
  const prepared = yield* SubscriptionRef.make<Option.Option<PreparedConnection>>(Option.none());
  const currentEntry = options?.entryRef ?? (yield* Ref.make(entry));
  const currentRoutes = Ref.get(currentEntry).pipe(Effect.map(connectionRoutes));
  const preferredRoute = yield* Ref.make(Option.none<ConnectionDriver.PreparedRoute>());
  const routeCooldowns = yield* Ref.make<ReadonlyMap<string, bigint>>(new Map());

  const attemptEntry = Effect.gen(function* () {
    const latest = yield* Ref.get(currentEntry);
    const routes = connectionRoutes(latest);
    const preferred = yield* Ref.getAndSet(preferredRoute, Option.none());
    if (Option.isNone(preferred)) return { entry: latest, preflight: undefined };
    const route = routes.find(
      (candidate) =>
        connectionRouteId(candidate.target) === connectionRouteId(preferred.value.route.target),
    );
    return route === undefined
      ? { entry: latest, preflight: undefined }
      : {
          entry: entryWithRoutes(latest, [
            route,
            ...routes.filter((candidate) => candidate !== route),
          ]),
          preflight: preferred.value,
        };
  });

  const routeIndex = (lease: ConnectionDriver.EnvironmentConnectionLease) =>
    currentRoutes.pipe(
      Effect.map((routes) =>
        routes.findIndex(
          (route) => connectionRouteId(route.target) === connectionRouteId(lease.prepared.target),
        ),
      ),
    );

  /**
   * Preflights the routes ranked above the one in use and signals the best
   * that would connect. Routes without a cheap check (SSH) never
   * pass, so they are fallbacks, not destinations.
   */
  const checkBetterRoutes = Effect.fnUntraced(function* (
    lease: ConnectionDriver.EnvironmentConnectionLease,
  ) {
    if ((yield* Ref.get(intent)).backgrounded) return;
    const latest = yield* Ref.get(currentEntry);
    const current = yield* routeIndex(lease);
    if (current <= 0) return;
    const now = yield* Clock.monotonicTimeNanos;
    const cooldowns = yield* Ref.get(routeCooldowns);
    const better = connectionRoutes(latest)
      .slice(0, current)
      .filter((route) => (cooldowns.get(connectionRouteId(route.target)) ?? 0n) <= now);
    const passed = yield* Effect.forEach(
      better,
      (route: ConnectionRoute) => driver.preflight(latest, route),
      { concurrency: "unbounded" },
    );
    const preflight = passed.find(Option.isSome);
    if (preflight === undefined) return;
    const live = yield* SubscriptionRef.get(session);
    if (Option.isNone(live) || live.value !== lease.session) return;
    yield* signal({
      _tag: "BetterRouteAvailable",
      preflight: preflight.value,
    });
  });

  // Run one check at a time and retain at most one pending trigger.
  const betterRouteChecks = yield* Queue.dropping<ConnectionDriver.EnvironmentConnectionLease>(1);
  const requestBetterRouteCheck = (lease: ConnectionDriver.EnvironmentConnectionLease) =>
    routeIndex(lease).pipe(
      Effect.flatMap((index) =>
        index > 0 ? Queue.offer(betterRouteChecks, lease).pipe(Effect.asVoid) : Effect.void,
      ),
    );

  const clearLease = Effect.all(
    [SubscriptionRef.set(session, Option.none()), SubscriptionRef.set(prepared, Option.none())],
    { discard: true },
  );

  const setState = Effect.fn("EnvironmentSupervisor.setState")(function* (
    next: SupervisorConnectionState,
  ) {
    yield* SubscriptionRef.set(state, next);
  });

  const signal = Effect.fn("EnvironmentSupervisor.signal")(function* (next: SupervisorSignal) {
    yield* Queue.offer(signals, next);
  });

  const reportProgress = Effect.fn("EnvironmentSupervisor.reportProgress")(function* (
    attempt: number,
    generation: number,
    lastFailure: ConnectionAttemptError | null,
    progress: ConnectionDriver.ConnectionDriverProgress,
  ) {
    if ("prepared" in progress) {
      yield* SubscriptionRef.set(prepared, Option.some(progress.prepared));
    }
    yield* setState(
      connectingState(yield* Ref.get(intent), generation, attempt, lastFailure, progress.stage),
    );
  });

  const establishConnection = Effect.fn("environment.connection.attempt")(function* (
    attempt: number,
    generation: number,
    lastFailure: ConnectionAttemptError | null,
    synchronizedRoutes: Ref.Ref<number>,
  ) {
    yield* Effect.annotateCurrentSpan({
      "connection.attempt": attempt,
      "connection.generation": generation,
    });
    const next = yield* attemptEntry;
    return yield* driver
      .connect(
        next.entry,
        (progress) =>
          (progress.stage === "synchronizing"
            ? Ref.update(synchronizedRoutes, (count) => count + 1)
            : Effect.void
          ).pipe(Effect.andThen(reportProgress(attempt, generation, lastFailure, progress))),
        next.preflight,
      )
      .pipe(
        Effect.onExit(
          Effect.fnUntraced(function* (exit) {
            if (Exit.isSuccess(exit)) {
              const leaseTarget = exit.value.prepared.target;
              const route = (yield* currentRoutes).find(
                (candidate) =>
                  connectionRouteId(candidate.target) === connectionRouteId(leaseTarget),
              );
              return yield* Effect.annotateCurrentSpan({
                "connection.outcome": "connected",
                "connection.route": connectionRouteKind(
                  route ?? { target: leaseTarget, profile: Option.none() },
                ),
              });
            }
            if (Cause.hasInterruptsOnly(exit.cause)) {
              return yield* Effect.annotateCurrentSpan("connection.outcome", "interrupted");
            }
            const failure = exit.cause.reasons.find(Cause.isFailReason)?.error;
            yield* Effect.annotateCurrentSpan({
              "connection.outcome": "failed",
              "connection.failure.tag": failure?._tag ?? "defect",
              "connection.failure.reason": failure?.reason ?? "defect",
            });
          }),
        ),
      );
  });

  const waitForEstablishmentInterrupt = Effect.fnUntraced(function* (ignoreOffline: boolean) {
    for (;;) {
      const next = yield* Queue.take(signals);
      switch (next._tag) {
        case "DisconnectRequested":
        case "RetryRequested":
          return false;
        case "NetworkChanged":
          if (next.network === "offline" && !ignoreOffline) {
            return false;
          }
          break;
        case "ConnectRequested":
        case "BetterRouteAvailable":
          break;
        case "Wakeup":
          if (next.reason === "application-background") return false;
          if (next.reason === "application-resumed" || next.reason === "network-changed") {
            return true;
          }
          break;
      }
    }
  });

  const connectedLeaseEnd = Effect.fnUntraced(function* (
    next: SupervisorSignal,
    lease: ConnectionDriver.EnvironmentConnectionLease,
  ) {
    if (next._tag === "DisconnectRequested") {
      return "end" as const;
    }
    if (next._tag === "BetterRouteAvailable") {
      const routes = yield* currentRoutes;
      const preferredIndex = routes.findIndex((route) => Equal.equals(route, next.preflight.route));
      const activeIndex = routes.findIndex(
        (route) => connectionRouteId(route.target) === connectionRouteId(lease.prepared.target),
      );
      if (preferredIndex < 0 || preferredIndex >= activeIndex) return undefined;
      yield* Ref.set(preferredRoute, Option.some(next.preflight));
      return "reset" as const;
    }
    return undefined;
  });

  const probeTimeoutFor = (next: SupervisorSignal): Duration.Input | undefined => {
    switch (next._tag) {
      case "RetryRequested":
        return QUICK_CONNECTION_PROBE_TIMEOUT;
      case "NetworkChanged":
        return next.network === "offline" ? QUICK_CONNECTION_PROBE_TIMEOUT : undefined;
      case "Wakeup":
        if (next.reason === "application-active") {
          return CONNECTION_PROBE_TIMEOUT;
        }
        return next.reason === "application-resumed" || next.reason === "network-changed"
          ? QUICK_CONNECTION_PROBE_TIMEOUT
          : undefined;
      case "ConnectRequested":
      case "DisconnectRequested":
      case "BetterRouteAvailable":
        return undefined;
    }
  };

  const monitorConnectedLease = Effect.fnUntraced(function* (
    lease: ConnectionDriver.EnvironmentConnectionLease,
  ) {
    // A probe answers an explicit retry here, so the retry must not also reset
    // the backoff of a later, unrelated failure.
    const takeSignal = Queue.take(signals).pipe(
      Effect.tap((next) =>
        next._tag === "RetryRequested" ? Ref.set(resetRetryState, false) : Effect.void,
      ),
    );
    yield* Stream.tick(BETTER_ROUTE_CHECK_INTERVAL).pipe(
      Stream.drop(1),
      Stream.runForEach(() => requestBetterRouteCheck(lease)),
      Effect.forkScoped,
    );
    for (;;) {
      const next = yield* takeSignal;
      const end = yield* connectedLeaseEnd(next, lease);
      if (end !== undefined) {
        return end === "reset";
      }
      if ((yield* Ref.get(intent)).backgrounded) continue;
      if (
        (next._tag === "NetworkChanged" && next.network !== "offline") ||
        next._tag === "Wakeup" ||
        next._tag === "RetryRequested"
      )
        yield* requestBetterRouteCheck(lease);
      const probeTimeout = probeTimeoutFor(next);
      if (probeTimeout === undefined) {
        continue;
      }
      yield* Ref.set(
        pendingProbe,
        next._tag === "Wakeup" && next.reason === "application-resumed"
          ? "mobile-resume"
          : "checking",
      );
      const probe = yield* Effect.forkChild(lease.session.probe);
      let deadline = (yield* Clock.monotonicTimeNanos) + Duration.toNanosUnsafe(probeTimeout);
      for (;;) {
        const remaining = deadline - (yield* Clock.monotonicTimeNanos);
        const probeEvent = yield* Effect.raceAllFirst([
          Fiber.await(probe).pipe(
            Effect.map((exit) => ({ _tag: "ProbeCompleted" as const, exit })),
          ),
          takeSignal.pipe(Effect.map((signal) => ({ _tag: "Signal" as const, signal }))),
          Effect.sleep(Duration.nanos(remaining > 0n ? remaining : 0n)).pipe(
            Effect.as({ _tag: "TimedOut" as const }),
          ),
        ]);
        if (probeEvent._tag === "TimedOut") {
          yield* Fiber.interrupt(probe);
          return yield* new ConnectionTransientError({
            reason: "timeout",
            detail: `${target.label} did not respond to a connection health check.`,
          });
        }
        if (probeEvent._tag === "ProbeCompleted") {
          if (Exit.isSuccess(probeEvent.exit)) {
            yield* Ref.set(pendingProbe, "idle");
          }
          yield* probeEvent.exit;
          break;
        }
        const endDuringProbe = yield* connectedLeaseEnd(probeEvent.signal, lease);
        if (endDuringProbe !== undefined) {
          yield* Fiber.interrupt(probe);
          return endDuringProbe === "reset";
        }
        if ((yield* Ref.get(intent)).backgrounded) {
          yield* Fiber.interrupt(probe);
          yield* Ref.set(pendingProbe, "idle");
          break;
        }
        if (
          probeEvent.signal._tag === "Wakeup" &&
          probeEvent.signal.reason === "application-resumed"
        )
          yield* Ref.set(pendingProbe, "mobile-resume");
        const signalTimeout = probeTimeoutFor(probeEvent.signal);
        if (signalTimeout !== undefined) {
          const signalDeadline =
            (yield* Clock.monotonicTimeNanos) + Duration.toNanosUnsafe(signalTimeout);
          if (signalDeadline < deadline) deadline = signalDeadline;
        }
      }
    }
  });

  const learnRoutesFrom = Effect.fnUntraced(function* (
    lease: ConnectionDriver.EnvironmentConnectionLease,
  ) {
    if (options?.learnRoutes === undefined) return;
    const learn = options.learnRoutes;
    yield* lease.session.configChanges.pipe(
      Stream.map(advertisedConnectionRoutes),
      Stream.changesWith<ConnectionRouteAdvertisements>(Equal.equals),
      Stream.runForEach((advertised) =>
        Effect.gen(function* () {
          if (advertised.reported === undefined && advertised.relayAdvertisement === undefined)
            return;
          const activeId = connectionRouteId(lease.prepared.target);
          const previousEntry = yield* Ref.get(currentEntry);
          const activeRoute = connectionRoutes(previousEntry).find(
            (route) => connectionRouteId(route.target) === activeId,
          );
          if (activeRoute === undefined) return;
          const updated = yield* learn({
            ...advertised,
            activeRoute,
            sourceSession: lease.session,
          });
          if (Option.isSome(updated)) {
            yield* Ref.update(currentEntry, (latest) =>
              latest === previousEntry ? updated.value : latest,
            );
            yield* requestBetterRouteCheck(lease);
          }
        }),
      ),
    );
  });

  const runAttempt = Effect.fnUntraced(function* (
    attempt: number,
    generation: number,
    lastFailure: ConnectionAttemptError | null,
    ignoreOffline: boolean,
  ) {
    const switchingTo = yield* Ref.get(preferredRoute);
    const routeCount = connectionRoutes(yield* Ref.get(currentEntry)).length;
    yield* SubscriptionRef.set(prepared, Option.none());
    const synchronizedRoutes = yield* Ref.make(0);
    const establishment = yield* Effect.raceAllFirst([
      exitUnlessInterrupted(
        establishConnection(attempt, generation, lastFailure, synchronizedRoutes),
      ).pipe(
        Effect.map((exit): EstablishmentEvent => ({
          _tag: "Completed",
          exit,
        })),
      ),
      waitForEstablishmentInterrupt(ignoreOffline).pipe(
        Effect.map((resetRetry): EstablishmentEvent => ({
          _tag: "Interrupted",
          resetRetry,
        })),
      ),
      // Every route gets a full setup timeout, after the driver has waited
      // for routes that were slow to answer their check. Each route that
      // reaches synchronizing adds its own snapshot budget, so a route that
      // fails late does not eat the next route's time.
      Effect.gen(function* () {
        const startedAt = yield* Clock.monotonicTimeNanos;
        const setup = Duration.toNanosUnsafe(
          Duration.sum(
            Duration.times(Duration.fromInputUnsafe(CONNECTION_ESTABLISHMENT_TIMEOUT), routeCount),
            Duration.millis(routeCount > 1 ? ConnectionDriver.LATE_ROUTE_CHECK_TIMEOUT_MS : 0),
          ),
        );
        while (true) {
          const synchronized = BigInt(yield* Ref.get(synchronizedRoutes));
          const deadline =
            startedAt + setup + synchronized * Duration.toNanosUnsafe(synchronizationTimeout);
          const remaining = deadline - (yield* Clock.monotonicTimeNanos);
          if (remaining <= 0n) {
            return { _tag: "TimedOut" } as const satisfies EstablishmentEvent;
          }
          yield* Effect.sleep(Duration.nanos(remaining));
        }
      }),
    ]);

    if (establishment._tag === "Interrupted") {
      return {
        _tag: "Interrupted",
        established: false,
        stable: false,
        resetRetry: establishment.resetRetry,
      } satisfies AttemptOutcome;
    }
    if (establishment._tag === "TimedOut") {
      return {
        _tag: "Failure",
        established: false,
        stable: false,
        error: new ConnectionTransientError({
          reason: "timeout",
          detail: setupTimeoutDetail,
        }),
      } satisfies AttemptOutcome;
    }
    if (Exit.isFailure(establishment.exit)) {
      const isUnexpectedDefect =
        !Cause.hasInterruptsOnly(establishment.exit.cause) &&
        !establishment.exit.cause.reasons.some(Cause.isFailReason);
      const outcome = failureFromExit(target, establishment.exit, false, false);
      if (isUnexpectedDefect) {
        const defect = establishment.exit.cause.reasons.find(Cause.isDieReason)?.defect;
        yield* Effect.logError("Connection attempt failed with an unexpected defect.").pipe(
          Effect.annotateLogs({
            "environment.id": target.environmentId,
            "environment.label": target.label,
            "cause.reason_count": establishment.exit.cause.reasons.length,
            ...safeErrorLogAttributes(defect),
          }),
        );
      }
      return outcome;
    }

    const lease = establishment.exit.value;
    if (Option.isSome(switchingTo)) {
      const landed = connectionRouteId(lease.prepared.target);
      const preferredId = connectionRouteId(switchingTo.value.route.target);
      if (landed !== preferredId) {
        const until =
          (yield* Clock.monotonicTimeNanos) + BigInt(BETTER_ROUTE_COOLDOWN_MS) * 1_000_000n;
        yield* Ref.update(routeCooldowns, (current) => new Map(current).set(preferredId, until));
      }
    }

    const currentIntent = yield* Ref.get(intent);
    if (!currentIntent.desired || (currentIntent.network === "offline" && !ignoreOffline)) {
      return {
        _tag: "Interrupted",
        established: false,
        stable: false,
        resetRetry: false,
      } satisfies AttemptOutcome;
    }

    const connectedAt = yield* Clock.currentTimeMillis;
    yield* SubscriptionRef.set(prepared, Option.some(lease.prepared));
    yield* SubscriptionRef.set(session, Option.some(lease.session));
    yield* learnRoutesFrom(lease).pipe(Effect.forkScoped);
    yield* setState({
      desired: true,
      network: currentIntent.network,
      phase: "connected",
      stage: null,
      attempt,
      generation,
      lastFailure: null,
      retryAt: null,
    });

    const connectedExit = yield* Effect.raceFirst(
      lease.session.closed,
      monitorConnectedLease(lease),
    ).pipe(exitUnlessInterrupted);
    const connectedForMs = (yield* Clock.currentTimeMillis) - connectedAt;
    if (Exit.isSuccess(connectedExit)) {
      return {
        _tag: "Interrupted",
        established: true,
        stable: connectedForMs >= BACKOFF_RESET_AFTER_MS,
        resetRetry: connectedExit.value,
      } satisfies AttemptOutcome;
    }
    const outcome = failureFromExit(
      target,
      connectedExit,
      true,
      connectedForMs >= BACKOFF_RESET_AFTER_MS,
    );
    if (outcome._tag === "Failure") {
      yield* Effect.void.pipe(
        Effect.withSpan("EnvironmentSupervisor.connectionLost", {
          root: true,
          attributes: {
            "environment.id": target.environmentId,
            "environment.label": target.label,
            "environment.target.kind": target._tag,
            "connection.connected_ms": connectedForMs,
            "connection.failure.reason": outcome.error.reason,
            "connection.failure.detail": outcome.error.detail,
          },
        }),
      );
    }
    return outcome;
  }, Effect.ensuring(clearLease));

  const waitForRetrySignal = Effect.fnUntraced(function* (delayMs: number) {
    // @effect-diagnostics-next-line raceFirstWithSleepToTimeout:off -- The sleep is the retry delay, not a timeout around the signal loop.
    return yield* Effect.raceFirst(
      Effect.sleep(delayMs).pipe(Effect.as(null)),
      Effect.gen(function* () {
        for (;;) {
          const next = yield* Queue.take(signals);
          switch (next._tag) {
            case "Wakeup":
              return ConnectionWakeups.shouldResubscribeAfterWakeup(next.reason)
                ? next.reason
                : null;
            case "ConnectRequested":
            case "DisconnectRequested":
            case "RetryRequested":
            case "NetworkChanged":
              return null;
            case "BetterRouteAvailable":
              break;
          }
        }
      }),
    );
  });

  const waitForSignal = Queue.take(signals).pipe(
    Effect.repeat({ while: (next) => next._tag === "BetterRouteAvailable" }),
    Effect.map((next) =>
      next._tag === "Wakeup" && ConnectionWakeups.shouldResubscribeAfterWakeup(next.reason)
        ? next.reason
        : null,
    ),
  );

  const run = Effect.fnUntraced(function* () {
    let failureCount = 0;
    let generation = 0;
    let latestFailure: ConnectionAttemptError | null = null;
    const resetRetryLadder = () => {
      failureCount = 0;
    };
    let attemptWhileOffline = false;
    const retryImmediately = (allowOffline: boolean) => {
      resetRetryLadder();
      if (allowOffline && latestFailure?._tag === "ConnectionTransientError") latestFailure = null;
      attemptWhileOffline = allowOffline;
    };

    for (;;) {
      if (yield* Ref.getAndSet(resetRetryState, false)) {
        failureCount = 0;
        latestFailure = null;
      }
      const currentIntent = yield* Ref.get(intent);
      if (!currentIntent.desired) {
        resetRetryLadder();
        latestFailure = null;
        yield* clearLease;
        yield* setState(availableState(currentIntent, generation));
        yield* waitForSignal;
        continue;
      }
      if (currentIntent.backgrounded) {
        yield* clearLease;
        if (latestFailure?._tag !== "ConnectionBlockedError") {
          latestFailure = null;
          yield* setState(connectingState(currentIntent, generation, 1, null));
        }
        const applicationActivated = yield* waitForSignal;
        if (applicationActivated !== null) {
          retryImmediately(applicationActivated === "application-resumed");
        }
        continue;
      }
      if (currentIntent.network === "offline" && !attemptWhileOffline) {
        yield* clearLease;
        yield* setState(offlineState(currentIntent, generation, failureCount + 1, latestFailure));
        const applicationActivated = yield* waitForSignal;
        if (applicationActivated !== null) {
          retryImmediately(applicationActivated === "application-resumed");
        }
        continue;
      }

      const attempt = failureCount + 1;
      const nextGeneration = generation + 1;
      const outcome: AttemptOutcome = yield* Effect.scoped(
        runAttempt(attempt, nextGeneration, latestFailure, attemptWhileOffline),
      );
      attemptWhileOffline = false;
      const probeStatus = yield* Ref.getAndSet(pendingProbe, "idle");
      if (outcome.established) {
        generation = nextGeneration;

        latestFailure = null;
        if (outcome.stable) {
          resetRetryLadder();
        }
      }
      if (outcome._tag === "Interrupted") {
        if (outcome.resetRetry) {
          retryImmediately(true);
        }
        continue;
      }

      const error: ConnectionAttemptError = outcome.error;
      if ((yield* Ref.get(intent)).backgrounded && error._tag === "ConnectionTransientError") {
        latestFailure = null;
        continue;
      }
      if (!outcome.established) {
        latestFailure = error;
      }
      if (error._tag === "ConnectionBlockedError") {
        const blockedIntent = yield* Ref.get(intent);
        yield* setState({
          desired: blockedIntent.desired,
          network: blockedIntent.network,
          phase: "blocked",
          stage: null,
          attempt,
          generation,
          lastFailure: error,
          retryAt: null,
        });
        const applicationActivated = yield* waitForSignal;
        if (applicationActivated !== null) {
          retryImmediately(applicationActivated === "application-resumed");
        }
        continue;
      }

      if (probeStatus !== "idle") {
        resetRetryLadder();
        attemptWhileOffline = probeStatus === "mobile-resume";
        yield* setState(connectingState(yield* Ref.get(intent), generation, 1, latestFailure));
        continue;
      }

      failureCount += 1;
      const delayMs = retryDelayMs(failureCount - 1, yield* Random.next);
      const failedIntent = yield* Ref.get(intent);
      yield* setState({
        desired: failedIntent.desired,
        network: failedIntent.network,
        phase: "backoff",
        stage: null,
        attempt,
        generation,
        lastFailure: latestFailure,
        retryAt: (yield* Clock.currentTimeMillis) + delayMs,
      });
      const applicationActivated = yield* waitForRetrySignal(delayMs);
      if (applicationActivated !== null) {
        retryImmediately(applicationActivated === "application-resumed");
      }
    }
  });

  yield* connectivity.changes.pipe(
    Stream.runForEach((network) =>
      Ref.modify(intent, (current) =>
        current.network === network ? [false, current] : ([true, { ...current, network }] as const),
      ).pipe(
        Effect.flatMap((changed) =>
          changed ? signal({ _tag: "NetworkChanged", network }) : Effect.void,
        ),
      ),
    ),
    Effect.forkScoped,
  );
  yield* wakeups.changes.pipe(
    Stream.runForEach((reason) =>
      Ref.update(intent, (current) => ({
        ...current,
        backgrounded:
          reason === "application-background"
            ? true
            : ConnectionWakeups.shouldResubscribeAfterWakeup(reason)
              ? false
              : current.backgrounded,
      })).pipe(Effect.andThen(signal({ _tag: "Wakeup", reason }))),
    ),
    Effect.forkScoped({ startImmediately: true }),
  );
  yield* Queue.take(betterRouteChecks).pipe(
    Effect.flatMap(checkBetterRoutes),
    Effect.forever,
    Effect.forkScoped,
  );
  yield* run().pipe(Effect.forkScoped);

  const connect = Ref.update(intent, (current) => ({
    ...current,
    desired: true,
  })).pipe(
    Effect.andThen(signal({ _tag: "ConnectRequested" })),
    Effect.withSpan("EnvironmentSupervisor.connect"),
  );

  const disconnect = Ref.update(intent, (current) => ({
    ...current,
    desired: false,
  })).pipe(
    Effect.andThen(signal({ _tag: "DisconnectRequested" })),
    Effect.withSpan("EnvironmentSupervisor.disconnect"),
  );

  const retryNow = Ref.set(resetRetryState, true).pipe(
    Effect.andThen(signal({ _tag: "RetryRequested" })),
    Effect.withSpan("EnvironmentSupervisor.retryNow"),
  );

  yield* Effect.addFinalizer(() => Queue.shutdown(signals).pipe(Effect.andThen(clearLease)));

  return EnvironmentSupervisor.of({
    target,
    state,
    session,
    prepared,
    connect,
    disconnect,
    retryNow,
  });
});
