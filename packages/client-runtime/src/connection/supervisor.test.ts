import { EnvironmentId } from "@supaterm/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Random from "effect/Random";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as TestClock from "effect/testing/TestClock";

import type { WsRpcProtocolClient } from "../rpc/protocol.ts";
import {
  BearerConnectionProfile,
  type ConnectionCatalogEntry,
  type ConnectionRoute,
} from "./catalog.ts";
import * as Connectivity from "./connectivity.ts";
import * as ConnectionDriver from "./driver.ts";
import {
  ConnectionBlockedError,
  ConnectionTransientError,
  BearerConnectionTarget,
  PrimaryConnectionTarget,
  type ConnectionAttemptError,
  type ConnectionTarget,
  type NetworkStatus,
  type PreparedConnection,
  type SupervisorConnectionState,
} from "./model.ts";
import * as RpcSession from "../rpc/session.ts";
import * as EnvironmentSupervisor from "./supervisor.ts";
import * as ConnectionWakeups from "./wakeups.ts";

const TARGET = new PrimaryConnectionTarget({
  environmentId: EnvironmentId.make("environment-1"),
  label: "Test environment",
  httpBaseUrl: "https://environment.example.test",
  wsBaseUrl: "wss://environment.example.test",
});

const TARGET_ENTRY: ConnectionCatalogEntry = {
  target: TARGET,
  profile: Option.none(),
  enabled: true,
};
const LAN_TARGET = new BearerConnectionTarget({
  environmentId: TARGET.environmentId,
  label: TARGET.label,
  connectionId: "lan",
});
const TAILNET_TARGET = new BearerConnectionTarget({
  environmentId: TARGET.environmentId,
  label: TARGET.label,
  connectionId: "tailnet",
});
const LAN_ROUTE: ConnectionRoute = {
  target: LAN_TARGET,
  profile: Option.some(
    new BearerConnectionProfile({
      connectionId: "lan",
      environmentId: TARGET.environmentId,
      label: TARGET.label,
      httpBaseUrl: "http://192.168.1.2:4389/",
      wsBaseUrl: "ws://192.168.1.2:4389/",
    }),
  ),
};
const TAILNET_ROUTE: ConnectionRoute = {
  target: TAILNET_TARGET,
  profile: Option.some(
    new BearerConnectionProfile({
      connectionId: "tailnet",
      environmentId: TARGET.environmentId,
      label: TARGET.label,
      httpBaseUrl: "http://100.100.1.2:4389/",
      wsBaseUrl: "ws://100.100.1.2:4389/",
    }),
  ),
};
const RELAY_TARGET = new BearerConnectionTarget({
  environmentId: TARGET.environmentId,
  label: TARGET.label,
  connectionId: "relay",
});
const RELAY_ROUTE: ConnectionRoute = {
  target: RELAY_TARGET,
  profile: Option.some(
    new BearerConnectionProfile({
      connectionId: "relay",
      environmentId: TARGET.environmentId,
      label: TARGET.label,
      httpBaseUrl: `https://${"11".repeat(16)}.${"22".repeat(16)}.relay.supaterm.alt/`,
      wsBaseUrl: `wss://${"11".repeat(16)}.${"22".repeat(16)}.relay.supaterm.alt/`,
    }),
  ),
};

const PREPARED_CONNECTION: PreparedConnection = {
  environmentId: TARGET.environmentId,
  label: TARGET.label,
  httpBaseUrl: TARGET.httpBaseUrl,
  socketUrl: "wss://environment.example.test/ws",
  httpAuthorization: null,
  target: TARGET,
};

const TEST_RPC_CLIENT = {} as WsRpcProtocolClient;

function transient(message = "Connection failed.") {
  return new ConnectionTransientError({
    reason: "transport",
    detail: message,
  });
}

function blocked(message = "Authentication required.") {
  return new ConnectionBlockedError({
    reason: "authentication",
    detail: message,
  });
}

function awaitState(
  state: SubscriptionRef.SubscriptionRef<SupervisorConnectionState>,
  predicate: (value: SupervisorConnectionState) => boolean,
) {
  return SubscriptionRef.changes(state).pipe(
    Stream.filter(predicate),
    Stream.runHead,
    Effect.map(Option.getOrThrow),
  );
}

const eventuallyState = Effect.fn("TestConnectionHarness.eventuallyState")(function* (
  state: SubscriptionRef.SubscriptionRef<SupervisorConnectionState>,
  predicate: (value: SupervisorConnectionState) => boolean,
) {
  let lastState = yield* SubscriptionRef.get(state);
  for (let iteration = 0; iteration < 100; iteration += 1) {
    lastState = yield* SubscriptionRef.get(state);
    if (predicate(lastState)) {
      return lastState;
    }
    yield* Effect.yieldNow;
  }
  return yield* Effect.die(
    new Error(
      `Expected supervisor state was not observed. Last state: phase=${lastState.phase}, stage=${lastState.stage ?? "none"}, attempt=${lastState.attempt}, generation=${lastState.generation}`,
    ),
  );
});

const makeHarness = Effect.fn("TestConnectionHarness.make")(function* (options?: {
  readonly backgrounded?: boolean;
  readonly networkStatus?: NetworkStatus;
  readonly prepare?: (
    attempt: number,
    target: ConnectionTarget,
  ) => Effect.Effect<PreparedConnection, ConnectionAttemptError>;
  readonly ready?: (attempt: number) => Effect.Effect<void, ConnectionAttemptError>;
  readonly probe?: (attempt: number) => Effect.Effect<void, ConnectionAttemptError>;
  readonly checkRoute?: (route: ConnectionRoute) => Effect.Effect<ConnectionDriver.RouteCheck>;
}) {
  const networkStatus = yield* SubscriptionRef.make<NetworkStatus>(
    options?.networkStatus ?? "online",
  );
  const prepareCount = yield* Ref.make(0);
  const sessionCount = yield* Ref.make(0);
  const releaseCount = yield* Ref.make(0);
  const wakeups = yield* SubscriptionRef.make<{
    readonly sequence: number;
    readonly reason: ConnectionWakeups.ConnectionWakeup;
  }>({
    sequence: 0,
    reason: "application-active",
  });
  const closedSessions = yield* Ref.make<
    ReadonlyArray<Deferred.Deferred<never, ConnectionTransientError>>
  >([]);

  const connectivity = Connectivity.Connectivity.of({
    status: SubscriptionRef.get(networkStatus),
    changes: SubscriptionRef.changes(networkStatus),
  });

  const prepare = Effect.fn("TestConnectionDriver.prepare")(function* (target: ConnectionTarget) {
    const attempt = yield* Ref.updateAndGet(prepareCount, (count) => count + 1);
    if (options?.prepare) {
      return yield* options.prepare(attempt, target);
    }
    return PREPARED_CONNECTION;
  });

  const connect = Effect.fn("TestConnectionDriver.connect")(function* (
    entry: ConnectionCatalogEntry,
    reportProgress: (progress: ConnectionDriver.ConnectionDriverProgress) => Effect.Effect<void>,
  ) {
    yield* reportProgress({ stage: "preparing" });
    return yield* ConnectionDriver.connectOverRoutes(
      entry,
      (route) => options?.checkRoute?.(route) ?? Effect.succeed("unchecked"),
      Effect.fnUntraced(function* (route) {
        const prepared = { ...(yield* prepare(route.target)), target: route.target };
        yield* reportProgress({ stage: "opening", prepared });

        const attempt = yield* Ref.updateAndGet(sessionCount, (count) => count + 1);
        const closed = yield* Deferred.make<never, ConnectionTransientError>();
        yield* Ref.update(closedSessions, (sessions) => [...sessions, closed]);

        const session = yield* Effect.acquireRelease(
          Effect.succeed({
            client: TEST_RPC_CLIENT,
            initialConfig: Effect.die(new Error("Initial config is not used by supervisor tests.")),
            configChanges: Stream.empty,
            subscribeServerConfig: (input) => TEST_RPC_CLIENT.subscribeServerConfig(input),
            ready: options?.ready?.(attempt) ?? Effect.void,
            probe: options?.probe?.(attempt) ?? Effect.void,
            closed: Deferred.await(closed),
          } satisfies RpcSession.RpcSession),
          () => Ref.update(releaseCount, (count) => count + 1),
        );

        yield* reportProgress({ stage: "synchronizing", prepared });
        return { prepared, session } satisfies ConnectionDriver.EnvironmentConnectionLease;
      }),
    );
  });

  const layerDependencies = Layer.mergeAll(
    Layer.succeed(Random.Random, {
      nextDoubleUnsafe: () => 1 - Number.EPSILON,
      nextIntUnsafe: () => 0,
    }),
    Layer.succeed(Connectivity.Connectivity, connectivity),
    Layer.succeed(
      ConnectionWakeups.ConnectionWakeups,
      ConnectionWakeups.ConnectionWakeups.of({
        isBackgrounded: Effect.succeed(options?.backgrounded ?? false),
        changes: SubscriptionRef.changes(wakeups).pipe(
          Stream.drop(1),
          Stream.map((event) => event.reason),
        ),
      }),
    ),
    Layer.succeed(
      ConnectionDriver.ConnectionDriver,
      ConnectionDriver.ConnectionDriver.of({
        connect,
        checkRoute: (_entry, route) =>
          options?.checkRoute?.(route) ?? Effect.succeed<ConnectionDriver.RouteCheck>("unchecked"),
        preflight: (_entry, route) =>
          (
            options?.checkRoute?.(route) ?? Effect.succeed<ConnectionDriver.RouteCheck>("unchecked")
          ).pipe(
            Effect.flatMap((check) =>
              check === "answered"
                ? Clock.monotonicTimeNanos.pipe(
                    Effect.map((now) =>
                      Option.some({
                        route,
                        prepared: { ...PREPARED_CONNECTION, target: route.target },
                        expiresAtNanos: now + 10_000_000_000n,
                      }),
                    ),
                  )
                : Effect.succeedNone,
            ),
          ),
      }),
    ),
  );

  return {
    dependencies: layerDependencies,
    prepareCount,
    sessionCount,
    releaseCount,
    setNetworkStatus: (status: NetworkStatus) => SubscriptionRef.set(networkStatus, status),
    wake: (reason: ConnectionWakeups.ConnectionWakeup) =>
      SubscriptionRef.update(wakeups, (event) => ({
        sequence: event.sequence + 1,
        reason,
      })),
    closeLatestSession: Effect.fn("TestConnectionHarness.closeLatestSession")(function* (
      error = transient("Session closed."),
    ) {
      const sessions = yield* Ref.get(closedSessions);
      const latest = sessions.at(-1);
      if (latest) {
        yield* Deferred.fail(latest, error);
      }
    }),
  };
});

describe("retryDelayMs", () => {
  it("doubles from 2 seconds to a 30 second cap, jittered within the upper half of each step", () => {
    const ceilings = [2_000, 4_000, 8_000, 16_000, 30_000];
    for (const [failureCount, ceiling] of [...ceilings, 30_000].entries()) {
      expect(EnvironmentSupervisor.retryDelayMs(failureCount, 0)).toBe(ceiling / 2);
      expect(EnvironmentSupervisor.retryDelayMs(failureCount, 0.5)).toBe((ceiling * 3) / 4);
      expect(EnvironmentSupervisor.retryDelayMs(failureCount, 1 - Number.EPSILON)).toBe(ceiling);
    }
  });
});

describe("EnvironmentSupervisor", () => {
  it.effect("keeps desktop activation parked while offline", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ networkStatus: "offline" });
      const supervisor = yield* EnvironmentSupervisor.make(TARGET_ENTRY, {
        initiallyDesired: true,
      }).pipe(Effect.provide(harness.dependencies));
      yield* awaitState(supervisor.state, (state) => state.phase === "offline");
      yield* harness.wake("application-active");
      yield* TestClock.adjust("5 minutes");
      expect(yield* Ref.get(harness.prepareCount)).toBe(0);
      yield* harness.setNetworkStatus("online");
      yield* awaitState(supervisor.state, (state) => state.phase === "connected");
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("ignores a late offline report during the mobile resume attempt", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const finish = yield* Deferred.make<PreparedConnection>();
      const harness = yield* makeHarness({
        backgrounded: true,
        prepare: () =>
          Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(finish))),
      });
      const supervisor = yield* EnvironmentSupervisor.make(TARGET_ENTRY, {
        initiallyDesired: true,
      }).pipe(Effect.provide(harness.dependencies));
      yield* TestClock.adjust(1);
      yield* harness.wake("application-resumed");
      yield* Deferred.await(started);
      yield* harness.setNetworkStatus("offline");
      yield* TestClock.adjust(1);
      yield* Deferred.succeed(finish, PREPARED_CONNECTION);
      const resumed = yield* awaitState(supervisor.state, (state) => state.phase === "connected");
      expect(resumed.network).toBe("offline");
      expect(yield* Ref.get(harness.prepareCount)).toBe(1);
      expect(yield* Ref.get(harness.sessionCount)).toBe(1);
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("does not dial a mobile connection that starts in the background", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ backgrounded: true });
      const supervisor = yield* EnvironmentSupervisor.make(TARGET_ENTRY, {
        initiallyDesired: true,
      }).pipe(Effect.provide(harness.dependencies));
      yield* TestClock.adjust("5 minutes");
      expect(yield* Ref.get(harness.prepareCount)).toBe(0);
      yield* harness.wake("application-resumed");
      yield* awaitState(supervisor.state, (state) => state.phase === "connected");
      expect(yield* Ref.get(harness.sessionCount)).toBe(1);
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("parks a background disconnect without errors or retry traffic", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const supervisor = yield* EnvironmentSupervisor.make(TARGET_ENTRY, {
        initiallyDesired: true,
      }).pipe(Effect.provide(harness.dependencies));
      yield* awaitState(supervisor.state, (state) => state.phase === "connected");
      yield* harness.wake("application-background");
      yield* harness.closeLatestSession(transient("Backgrounded"));
      const parked = yield* awaitState(
        supervisor.state,
        (state) =>
          state.phase === "connecting" && state.generation === 1 && state.lastFailure === null,
      );
      expect(parked.retryAt).toBeNull();
      yield* harness.setNetworkStatus("offline");
      yield* TestClock.adjust("5 minutes");
      expect(yield* Ref.get(harness.prepareCount)).toBe(1);
      yield* harness.wake("application-resumed");
      const resumed = yield* awaitState(
        supervisor.state,
        (state) => state.phase === "connected" && state.generation === 2,
      );
      expect(resumed.lastFailure).toBeNull();
      expect(resumed.attempt).toBe(1);
      expect(resumed.network).toBe("offline");
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("cancels connection setup while backgrounded and restarts on return", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const cancelled = yield* Deferred.make<void>();
      const harness = yield* makeHarness({
        prepare: (attempt) =>
          attempt === 1
            ? Deferred.succeed(started, undefined).pipe(
                Effect.andThen(Effect.never),
                Effect.onInterrupt(() => Deferred.succeed(cancelled, undefined)),
              )
            : Effect.succeed(PREPARED_CONNECTION),
      });
      const supervisor = yield* EnvironmentSupervisor.make(TARGET_ENTRY, {
        initiallyDesired: true,
      }).pipe(Effect.provide(harness.dependencies));
      yield* Deferred.await(started);
      yield* harness.wake("application-background");
      yield* Deferred.await(cancelled);
      yield* TestClock.adjust("5 minutes");
      expect(yield* Ref.get(harness.prepareCount)).toBe(1);
      yield* harness.wake("application-resumed");
      yield* awaitState(supervisor.state, (state) => state.phase === "connected");
      expect(yield* Ref.get(harness.prepareCount)).toBe(2);
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("reconnects after a failed resume probe despite an offline report", () =>
    Effect.gen(function* () {
      const count = yield* Ref.make(0);
      const offlineProbed = yield* Deferred.make<void>();
      const harness = yield* makeHarness({
        probe: () =>
          Ref.updateAndGet(count, (value) => value + 1).pipe(
            Effect.flatMap((value) =>
              value === 1
                ? Deferred.succeed(offlineProbed, undefined).pipe(Effect.asVoid)
                : Effect.fail(transient()),
            ),
          ),
      });
      const supervisor = yield* EnvironmentSupervisor.make(TARGET_ENTRY, {
        initiallyDesired: true,
      }).pipe(Effect.provide(harness.dependencies));
      yield* awaitState(supervisor.state, (state) => state.phase === "connected");
      yield* harness.setNetworkStatus("offline");
      yield* Deferred.await(offlineProbed);
      yield* harness.wake("application-resumed");
      const resumed = yield* awaitState(
        supervisor.state,
        (state) => state.phase === "connected" && state.generation === 2,
      );
      expect(resumed.network).toBe("offline");
      expect(resumed.attempt).toBe(1);
    }),
  );

  it.effect("does not attempt a connection until it is desired", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const supervisor = yield* EnvironmentSupervisor.make(TARGET_ENTRY).pipe(
        Effect.provide(harness.dependencies),
      );

      expect((yield* SubscriptionRef.get(supervisor.state)).phase).toBe("available");
      expect(yield* Ref.get(harness.prepareCount)).toBe(0);
    }),
  );

  it.effect("does not let the initial connect signal cancel the first attempt", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const supervisor = yield* EnvironmentSupervisor.make(TARGET_ENTRY).pipe(
        Effect.provide(harness.dependencies),
      );

      yield* supervisor.connect;
      yield* awaitState(supervisor.state, (state) => state.phase === "connected");

      expect(yield* Ref.get(harness.sessionCount)).toBe(1);
      expect(yield* Ref.get(harness.releaseCount)).toBe(0);
    }),
  );

  it.effect("waits while offline and connects immediately when the network returns", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ networkStatus: "offline" });
      const supervisor = yield* EnvironmentSupervisor.make(TARGET_ENTRY, {
        initiallyDesired: true,
      }).pipe(Effect.provide(harness.dependencies));

      yield* awaitState(supervisor.state, (state) => state.phase === "offline");
      expect(yield* Ref.get(harness.prepareCount)).toBe(0);

      yield* harness.setNetworkStatus("online");
      const ready = yield* awaitState(supervisor.state, (state) => state.phase === "connected");

      expect(ready).toMatchObject({
        desired: true,
        network: "online",
        phase: "connected",
        attempt: 1,
        generation: 1,
        lastFailure: null,
      });
      expect(yield* Ref.get(harness.prepareCount)).toBe(1);
    }),
  );

  it.effect("resumes before the network report catches up", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const supervisor = yield* EnvironmentSupervisor.make(TARGET_ENTRY, {
        initiallyDesired: true,
      }).pipe(Effect.provide(harness.dependencies));

      yield* awaitState(supervisor.state, (state) => state.phase === "connected");
      yield* harness.closeLatestSession();
      yield* awaitState(
        supervisor.state,
        (state) => state.phase === "backoff" && state.attempt === 1,
      );
      yield* harness.setNetworkStatus("offline");
      yield* awaitState(
        supervisor.state,
        (state) => state.phase === "offline" && state.attempt === 2,
      );

      yield* harness.wake("application-resumed");
      yield* awaitState(
        supervisor.state,
        (state) => state.phase === "connected" && state.generation === 2 && state.attempt === 1,
      );
    }),
  );

  it.effect("retries forever with exponential backoff capped at 30 seconds", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        prepare: () => Effect.fail(transient()),
      });
      const supervisor = yield* EnvironmentSupervisor.make(TARGET_ENTRY, {
        initiallyDesired: true,
      }).pipe(Effect.provide(harness.dependencies));

      yield* awaitState(
        supervisor.state,
        (state) => state.phase === "backoff" && state.attempt === 1,
      );
      expect(yield* Ref.get(harness.prepareCount)).toBe(1);

      const delays = [2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000];
      for (const [index, delay] of delays.entries()) {
        yield* TestClock.adjust(delay - 1);
        expect(yield* Ref.get(harness.prepareCount)).toBe(index + 1);
        yield* TestClock.adjust(1);
        yield* eventuallyState(
          supervisor.state,
          (state) => state.phase === "backoff" && state.attempt === index + 2,
        );
      }

      expect(yield* Ref.get(harness.prepareCount)).toBe(delays.length + 1);
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("keeps the latest failure visible throughout the next connection attempt", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        prepare: (attempt) =>
          attempt === 1 ? Effect.fail(transient("Connection timed out.")) : Effect.never,
      });
      const supervisor = yield* EnvironmentSupervisor.make(TARGET_ENTRY, {
        initiallyDesired: true,
      }).pipe(Effect.provide(harness.dependencies));

      yield* awaitState(
        supervisor.state,
        (state) => state.phase === "backoff" && state.attempt === 1,
      );
      yield* TestClock.adjust("3 seconds");

      const retrying = yield* awaitState(
        supervisor.state,
        (state) =>
          state.phase === "connecting" && state.stage === "preparing" && state.attempt === 2,
      );
      expect(retrying).toMatchObject({
        phase: "connecting",
        stage: "preparing",
        attempt: 2,
        lastFailure: {
          _tag: "ConnectionTransientError",
          reason: "transport",
          message: "Connection timed out.",
        },
      });
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("keeps a working socket open while a slow server config snapshot arrives", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        ready: () => Effect.sleep("40 seconds"),
      });
      const supervisor = yield* EnvironmentSupervisor.make(TARGET_ENTRY, {
        initiallyDesired: true,
      }).pipe(Effect.provide(harness.dependencies));

      yield* awaitState(
        supervisor.state,
        (state) => state.phase === "connecting" && state.stage === "synchronizing",
      );
      yield* TestClock.adjust("39 seconds");
      expect((yield* SubscriptionRef.get(supervisor.state)).phase).toBe("connecting");

      yield* TestClock.adjust("1 second");
      yield* awaitState(supervisor.state, (state) => state.phase === "connected");
      expect(yield* Ref.get(harness.prepareCount)).toBe(1);
      expect(yield* Ref.get(harness.releaseCount)).toBe(0);
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("retries when a session never becomes ready", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        ready: () => Effect.never,
      });
      const supervisor = yield* EnvironmentSupervisor.make(TARGET_ENTRY, {
        initiallyDesired: true,
      }).pipe(Effect.provide(harness.dependencies));

      yield* awaitState(
        supervisor.state,
        (state) => state.phase === "connecting" && state.stage === "synchronizing",
      );
      yield* TestClock.adjust("74 seconds");
      expect((yield* SubscriptionRef.get(supervisor.state)).stage).toBe("synchronizing");

      yield* TestClock.adjust("1 second");
      const retrying = yield* awaitState(supervisor.state, (state) => state.phase === "backoff");

      expect(retrying).toMatchObject({
        phase: "backoff",
        lastFailure: {
          _tag: "ConnectionTransientError",
          reason: "timeout",
          message: "Test environment did not respond during connection setup.",
        },
      });
      expect(yield* Ref.get(harness.releaseCount)).toBe(1);
      expect(Option.isNone(yield* SubscriptionRef.get(supervisor.prepared))).toBe(true);
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("interrupts and releases a connection attempt when setup times out", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        prepare: () => Effect.never,
      });
      const supervisor = yield* EnvironmentSupervisor.make(TARGET_ENTRY, {
        initiallyDesired: true,
      }).pipe(Effect.provide(harness.dependencies));

      yield* awaitState(
        supervisor.state,
        (state) => state.phase === "connecting" && state.stage === "preparing",
      );
      yield* TestClock.adjust("15 seconds");
      const retrying = yield* eventuallyState(
        supervisor.state,
        (state) => state.phase === "backoff" && state.attempt === 1,
      );

      expect(retrying).toMatchObject({
        lastFailure: {
          _tag: "ConnectionTransientError",
          reason: "timeout",
          message: "Test environment did not respond during connection setup.",
        },
      });
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("converts unexpected driver defects into retryable failures", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        prepare: (attempt) =>
          attempt === 1
            ? Effect.die(new Error("Native transport defect."))
            : Effect.succeed(PREPARED_CONNECTION),
      });
      const supervisor = yield* EnvironmentSupervisor.make(TARGET_ENTRY, {
        initiallyDesired: true,
      }).pipe(Effect.provide(harness.dependencies));

      const failed = yield* awaitState(
        supervisor.state,
        (state) => state.phase === "backoff" && state.attempt === 1,
      );
      expect(failed).toMatchObject({
        lastFailure: {
          _tag: "ConnectionTransientError",
          reason: "transport",
          message: "Test environment connection failed unexpectedly.",
        },
      });

      yield* TestClock.adjust("3 seconds");
      yield* awaitState(supervisor.state, (state) => state.phase === "connected");
      expect(yield* Ref.get(harness.prepareCount)).toBe(2);
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("explicit retry interrupts the current backoff", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        prepare: (attempt) =>
          attempt === 1 ? Effect.fail(transient()) : Effect.succeed(PREPARED_CONNECTION),
      });
      const supervisor = yield* EnvironmentSupervisor.make(TARGET_ENTRY, {
        initiallyDesired: true,
      }).pipe(Effect.provide(harness.dependencies));

      yield* awaitState(supervisor.state, (state) => state.phase === "backoff");
      yield* supervisor.retryNow;
      yield* awaitState(supervisor.state, (state) => state.phase === "connected");

      expect(yield* Ref.get(harness.prepareCount)).toBe(2);
    }),
  );

  it.effect("explicit retry starts a fresh backoff sequence", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        prepare: () => Effect.fail(transient()),
      });
      const supervisor = yield* EnvironmentSupervisor.make(TARGET_ENTRY, {
        initiallyDesired: true,
      }).pipe(Effect.provide(harness.dependencies));

      yield* awaitState(
        supervisor.state,
        (state) => state.phase === "backoff" && state.attempt === 1,
      );
      yield* TestClock.adjust("3 seconds");
      yield* eventuallyState(
        supervisor.state,
        (state) => state.phase === "backoff" && state.attempt === 2,
      );

      yield* supervisor.retryNow;
      yield* eventuallyState(
        supervisor.state,
        (state) => state.phase === "backoff" && state.attempt === 1,
      );
      expect(yield* Ref.get(harness.prepareCount)).toBe(3);

      yield* TestClock.adjust("1999 millis");
      expect(yield* Ref.get(harness.prepareCount)).toBe(3);
      yield* TestClock.adjust("1 milli");
      yield* eventuallyState(
        supervisor.state,
        (state) => state.phase === "backoff" && state.attempt === 2,
      );
      expect(yield* Ref.get(harness.prepareCount)).toBe(4);
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("keeps blocked failures idle until an external signal requests another attempt", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        prepare: (attempt) =>
          attempt === 1 ? Effect.fail(blocked()) : Effect.succeed(PREPARED_CONNECTION),
      });
      const supervisor = yield* EnvironmentSupervisor.make(TARGET_ENTRY, {
        initiallyDesired: true,
      }).pipe(Effect.provide(harness.dependencies));

      yield* awaitState(supervisor.state, (state) => state.phase === "blocked");
      yield* TestClock.adjust("1 hour");
      expect(yield* Ref.get(harness.prepareCount)).toBe(1);

      yield* supervisor.retryNow;
      yield* awaitState(supervisor.state, (state) => state.phase === "connected");
      expect(yield* Ref.get(harness.prepareCount)).toBe(2);
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("resets retries when activation wakes a blocked connection", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        prepare: (attempt) =>
          attempt === 1
            ? Effect.fail(transient())
            : attempt === 2
              ? Effect.fail(blocked())
              : Effect.succeed(PREPARED_CONNECTION),
      });
      const supervisor = yield* EnvironmentSupervisor.make(TARGET_ENTRY, {
        initiallyDesired: true,
      }).pipe(Effect.provide(harness.dependencies));

      yield* awaitState(
        supervisor.state,
        (state) => state.phase === "backoff" && state.attempt === 1,
      );
      yield* TestClock.adjust("3 seconds");
      yield* awaitState(
        supervisor.state,
        (state) => state.phase === "blocked" && state.attempt === 2,
      );

      yield* harness.wake("application-resumed");
      yield* awaitState(
        supervisor.state,
        (state) => state.phase === "connected" && state.attempt === 1,
      );
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("keeps a session that still answers when the network reports offline", () =>
    Effect.gen(function* () {
      const probeCount = yield* Ref.make(0);
      const harness = yield* makeHarness({
        probe: () => Ref.update(probeCount, (count) => count + 1),
      });
      const supervisor = yield* EnvironmentSupervisor.make(TARGET_ENTRY, {
        initiallyDesired: true,
      }).pipe(Effect.provide(harness.dependencies));

      yield* awaitState(
        supervisor.state,
        (state) => state.phase === "connected" && state.generation === 1,
      );
      yield* harness.setNetworkStatus("offline");
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if ((yield* Ref.get(probeCount)) > 0) break;
        yield* Effect.yieldNow;
      }
      yield* harness.setNetworkStatus("online");
      yield* Effect.yieldNow;

      expect(yield* Ref.get(probeCount)).toBe(1);
      expect(yield* Ref.get(harness.sessionCount)).toBe(1);
      expect(yield* Ref.get(harness.releaseCount)).toBe(0);
      expect(yield* SubscriptionRef.get(supervisor.state)).toMatchObject({
        phase: "connected",
        generation: 1,
      });
    }),
  );

  it.effect("keeps a healthy session when resuming with an offline report", () =>
    Effect.gen(function* () {
      const probeCount = yield* Ref.make(0);
      const resumed = yield* Deferred.make<void>();
      const harness = yield* makeHarness({
        probe: () =>
          Ref.updateAndGet(probeCount, (count) => count + 1).pipe(
            Effect.andThen(Deferred.succeed(resumed, undefined)),
            Effect.asVoid,
          ),
      });
      const supervisor = yield* EnvironmentSupervisor.make(TARGET_ENTRY, {
        initiallyDesired: true,
      }).pipe(Effect.provide(harness.dependencies));
      yield* awaitState(supervisor.state, (state) => state.phase === "connected");
      yield* harness.setNetworkStatus("offline");
      yield* harness.wake("application-resumed");
      yield* Deferred.await(resumed);
      expect(yield* Ref.get(harness.sessionCount)).toBe(1);
      expect(yield* Ref.get(harness.releaseCount)).toBe(0);
      expect(yield* SubscriptionRef.get(supervisor.state)).toMatchObject({
        phase: "connected",
        generation: 1,
      });
    }),
  );

  it.effect(
    "releases a session that stops answering while offline and reconnects when online",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeHarness({
          probe: (attempt) => (attempt === 1 ? Effect.never : Effect.void),
        });
        const supervisor = yield* EnvironmentSupervisor.make(TARGET_ENTRY, {
          initiallyDesired: true,
        }).pipe(Effect.provide(harness.dependencies));

        yield* awaitState(
          supervisor.state,
          (state) => state.phase === "connected" && state.generation === 1,
        );
        yield* harness.setNetworkStatus("offline");
        yield* TestClock.adjust("3 seconds");
        yield* awaitState(supervisor.state, (state) => state.phase === "offline");

        expect(yield* Ref.get(harness.releaseCount)).toBe(1);
        expect(Option.isNone(yield* SubscriptionRef.get(supervisor.session))).toBe(true);

        yield* harness.setNetworkStatus("online");
        yield* awaitState(
          supervisor.state,
          (state) => state.phase === "connected" && state.generation === 2,
        );
        expect(yield* Ref.get(harness.sessionCount)).toBe(2);
      }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("probes instead of replacing a healthy session on an explicit retry", () =>
    Effect.gen(function* () {
      const probeCount = yield* Ref.make(0);
      const harness = yield* makeHarness({
        probe: () => Ref.update(probeCount, (count) => count + 1),
      });
      const supervisor = yield* EnvironmentSupervisor.make(TARGET_ENTRY, {
        initiallyDesired: true,
      }).pipe(Effect.provide(harness.dependencies));

      yield* awaitState(supervisor.state, (state) => state.phase === "connected");
      yield* supervisor.retryNow;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if ((yield* Ref.get(probeCount)) > 0) break;
        yield* Effect.yieldNow;
      }

      expect(yield* Ref.get(probeCount)).toBe(1);
      expect(yield* Ref.get(harness.sessionCount)).toBe(1);
      expect(yield* Ref.get(harness.releaseCount)).toBe(0);
    }),
  );

  it.effect("keeps the backoff ladder after an explicit retry finds a healthy session", () =>
    Effect.gen(function* () {
      const probeCount = yield* Ref.make(0);
      const harness = yield* makeHarness({
        probe: () => Ref.update(probeCount, (count) => count + 1),
      });
      const supervisor = yield* EnvironmentSupervisor.make(TARGET_ENTRY, {
        initiallyDesired: true,
      }).pipe(Effect.provide(harness.dependencies));

      yield* awaitState(supervisor.state, (state) => state.phase === "connected");
      yield* harness.closeLatestSession();
      yield* awaitState(
        supervisor.state,
        (state) => state.phase === "backoff" && state.attempt === 1,
      );
      yield* TestClock.adjust("2 seconds");
      yield* awaitState(
        supervisor.state,
        (state) => state.phase === "connected" && state.generation === 2,
      );

      yield* supervisor.retryNow;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if ((yield* Ref.get(probeCount)) > 0) break;
        yield* Effect.yieldNow;
      }
      expect(yield* Ref.get(probeCount)).toBe(1);

      yield* harness.closeLatestSession();
      yield* awaitState(
        supervisor.state,
        (state) => state.phase === "backoff" && state.attempt === 2,
      );
      yield* TestClock.adjust("4 seconds");
      const reconnected = yield* awaitState(
        supervisor.state,
        (state) => state.phase === "connected" && state.generation === 3,
      );
      expect(reconnected.attempt).toBe(3);
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("retries a blocked connection when the application becomes active", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        prepare: (attempt) =>
          attempt === 1 ? Effect.fail(blocked()) : Effect.succeed(PREPARED_CONNECTION),
      });
      const supervisor = yield* EnvironmentSupervisor.make(TARGET_ENTRY, {
        initiallyDesired: true,
      }).pipe(Effect.provide(harness.dependencies));

      yield* awaitState(supervisor.state, (state) => state.phase === "blocked");
      yield* harness.wake("application-active");
      yield* awaitState(supervisor.state, (state) => state.phase === "connected");

      expect(yield* Ref.get(harness.prepareCount)).toBe(2);
    }),
  );

  it.effect("does not let desktop activation reset an in-flight attempt", () =>
    Effect.gen(function* () {
      const firstAttemptStarted = yield* Deferred.make<void>();
      const harness = yield* makeHarness({
        prepare: () =>
          Deferred.succeed(firstAttemptStarted, undefined).pipe(Effect.andThen(Effect.never)),
      });
      const supervisor = yield* EnvironmentSupervisor.make(TARGET_ENTRY, {
        initiallyDesired: true,
      }).pipe(Effect.provide(harness.dependencies));

      yield* Deferred.await(firstAttemptStarted);
      yield* Effect.all(
        [
          harness.wake("application-active"),
          harness.wake("application-active"),
          harness.wake("application-active"),
        ],
        { concurrency: "unbounded" },
      );
      yield* Effect.yieldNow;

      expect(yield* Ref.get(harness.prepareCount)).toBe(1);

      yield* TestClock.adjust("15 seconds");
      const retrying = yield* eventuallyState(
        supervisor.state,
        (state) => state.phase === "backoff" && state.attempt === 1,
      );

      expect(retrying).toMatchObject({
        lastFailure: {
          _tag: "ConnectionTransientError",
          reason: "timeout",
          message: "Test environment did not respond during connection setup.",
        },
      });
      expect(yield* Ref.get(harness.prepareCount)).toBe(1);
      expect(yield* Ref.get(harness.sessionCount)).toBe(0);
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("starts an in-flight attempt over when the device moves to another network", () =>
    Effect.gen(function* () {
      const firstAttemptStarted = yield* Deferred.make<void>();
      const harness = yield* makeHarness({
        prepare: (attempt) =>
          attempt === 1
            ? Deferred.succeed(firstAttemptStarted, undefined).pipe(Effect.andThen(Effect.never))
            : Effect.succeed(PREPARED_CONNECTION),
      });
      const supervisor = yield* EnvironmentSupervisor.make(TARGET_ENTRY, {
        initiallyDesired: true,
      }).pipe(Effect.provide(harness.dependencies));

      yield* Deferred.await(firstAttemptStarted);
      yield* harness.wake("network-changed");
      yield* awaitState(
        supervisor.state,
        (state) => state.phase === "connected" && state.generation === 1,
      );

      expect(yield* Ref.get(harness.prepareCount)).toBe(2);
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("treats an involuntary session close as transient and reconnects", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const supervisor = yield* EnvironmentSupervisor.make(TARGET_ENTRY, {
        initiallyDesired: true,
      }).pipe(Effect.provide(harness.dependencies));

      yield* awaitState(supervisor.state, (state) => state.phase === "connected");
      yield* harness.closeLatestSession();
      yield* awaitState(
        supervisor.state,
        (state) => state.phase === "backoff" && state.attempt === 1,
      );
      expect(Option.isNone(yield* SubscriptionRef.get(supervisor.prepared))).toBe(true);

      yield* TestClock.adjust("3 seconds");
      yield* awaitState(
        supervisor.state,
        (state) => state.phase === "connected" && state.generation === 2,
      );

      expect(yield* Ref.get(harness.sessionCount)).toBe(2);
      expect(Option.isSome(yield* SubscriptionRef.get(supervisor.prepared))).toBe(true);
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("keeps escalating backoff when a newly opened session flaps", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const supervisor = yield* EnvironmentSupervisor.make(TARGET_ENTRY, {
        initiallyDesired: true,
      }).pipe(Effect.provide(harness.dependencies));

      yield* awaitState(supervisor.state, (state) => state.phase === "connected");
      yield* harness.closeLatestSession();
      yield* awaitState(
        supervisor.state,
        (state) => state.phase === "backoff" && state.attempt === 1,
      );

      yield* TestClock.adjust("3 seconds");
      yield* awaitState(
        supervisor.state,
        (state) => state.phase === "connected" && state.generation === 2,
      );
      yield* harness.closeLatestSession();
      const secondFailure = yield* awaitState(
        supervisor.state,
        (state) => state.phase === "backoff" && state.attempt === 2,
      );

      expect(secondFailure.retryAt).not.toBeNull();

      yield* TestClock.adjust("3 seconds");
      expect(yield* Ref.get(harness.sessionCount)).toBe(2);

      yield* TestClock.adjust("1 second");
      yield* awaitState(
        supervisor.state,
        (state) => state.phase === "connected" && state.generation === 3,
      );
      expect(yield* Ref.get(harness.sessionCount)).toBe(3);
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("restarts the retry ladder when mobile returns to the foreground", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const supervisor = yield* EnvironmentSupervisor.make(TARGET_ENTRY, {
        initiallyDesired: true,
      }).pipe(Effect.provide(harness.dependencies));

      yield* awaitState(supervisor.state, (state) => state.phase === "connected");
      yield* harness.closeLatestSession();
      yield* awaitState(
        supervisor.state,
        (state) => state.phase === "backoff" && state.attempt === 1,
      );
      yield* TestClock.adjust("3 seconds");
      yield* awaitState(
        supervisor.state,
        (state) => state.phase === "connected" && state.generation === 2,
      );
      yield* harness.closeLatestSession();
      yield* awaitState(
        supervisor.state,
        (state) => state.phase === "backoff" && state.attempt === 2,
      );

      yield* harness.wake("application-resumed");
      yield* awaitState(
        supervisor.state,
        (state) => state.phase === "connected" && state.generation === 3 && state.attempt === 1,
      );
      yield* harness.closeLatestSession();
      yield* awaitState(
        supervisor.state,
        (state) => state.phase === "backoff" && state.attempt === 1,
      );

      expect(yield* Ref.get(harness.sessionCount)).toBe(3);
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("keeps retry history when a resume probe succeeds", () =>
    Effect.gen(function* () {
      const probed = yield* Deferred.make<void>();
      const harness = yield* makeHarness({
        probe: () => Deferred.succeed(probed, undefined).pipe(Effect.asVoid),
      });
      const supervisor = yield* EnvironmentSupervisor.make(TARGET_ENTRY, {
        initiallyDesired: true,
      }).pipe(Effect.provide(harness.dependencies));
      yield* awaitState(supervisor.state, (state) => state.phase === "connected");
      yield* harness.closeLatestSession();
      yield* awaitState(supervisor.state, (state) => state.phase === "backoff");
      yield* TestClock.adjust("2 seconds");
      yield* awaitState(
        supervisor.state,
        (state) => state.phase === "connected" && state.generation === 2,
      );
      yield* harness.wake("application-resumed");
      yield* Deferred.await(probed);
      yield* TestClock.adjust(1);
      expect(yield* Ref.get(harness.sessionCount)).toBe(2);
      yield* harness.closeLatestSession();
      const state = yield* awaitState(supervisor.state, (state) => state.phase === "backoff");
      expect(state.attempt).toBe(2);
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("restarts the retry ladder when a long resume interrupts connection setup", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        prepare: (attempt) => (attempt === 2 ? Effect.never : Effect.succeed(PREPARED_CONNECTION)),
      });
      const supervisor = yield* EnvironmentSupervisor.make(TARGET_ENTRY, {
        initiallyDesired: true,
      }).pipe(Effect.provide(harness.dependencies));

      yield* awaitState(supervisor.state, (state) => state.phase === "connected");
      yield* harness.closeLatestSession();
      yield* awaitState(
        supervisor.state,
        (state) => state.phase === "backoff" && state.attempt === 1,
      );
      yield* TestClock.adjust("3 seconds");
      yield* awaitState(
        supervisor.state,
        (state) => state.phase === "connecting" && state.attempt === 2,
      );

      yield* harness.wake("application-resumed");
      yield* awaitState(
        supervisor.state,
        (state) => state.phase === "connected" && state.generation === 2 && state.attempt === 1,
      );
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("probes the active session without reconnecting on application activation", () =>
    Effect.gen(function* () {
      const probeCount = yield* Ref.make(0);
      const probeCalled = yield* Deferred.make<void>();
      const harness = yield* makeHarness({
        probe: () =>
          Ref.update(probeCount, (count) => count + 1).pipe(
            Effect.andThen(Deferred.succeed(probeCalled, undefined)),
          ),
      });
      const supervisor = yield* EnvironmentSupervisor.make(TARGET_ENTRY, {
        initiallyDesired: true,
      }).pipe(Effect.provide(harness.dependencies));

      yield* awaitState(supervisor.state, (state) => state.phase === "connected");
      yield* harness.wake("application-active");
      yield* Deferred.await(probeCalled);

      expect(yield* Ref.get(probeCount)).toBe(1);
      expect(yield* Ref.get(harness.sessionCount)).toBe(1);
      expect(yield* Ref.get(harness.releaseCount)).toBe(0);
      expect((yield* SubscriptionRef.get(supervisor.state)).phase).toBe("connected");
    }),
  );

  it.effect.each(["3 seconds", "12 seconds", "45 seconds"] as const)(
    "reuses a healthy mobile session after %s in the background",
    (duration) =>
      Effect.gen(function* () {
        const probed = yield* Deferred.make<void>();
        const harness = yield* makeHarness({
          probe: () => Deferred.succeed(probed, undefined).pipe(Effect.asVoid),
        });
        const supervisor = yield* EnvironmentSupervisor.make(TARGET_ENTRY, {
          initiallyDesired: true,
        }).pipe(Effect.provide(harness.dependencies));
        yield* awaitState(supervisor.state, (state) => state.phase === "connected");
        yield* harness.wake("application-background");
        yield* TestClock.adjust(duration);
        yield* harness.wake("application-resumed");
        yield* Deferred.await(probed);
        expect(yield* Ref.get(harness.sessionCount)).toBe(1);
        expect(yield* Ref.get(harness.releaseCount)).toBe(0);
        expect(yield* SubscriptionRef.get(supervisor.state)).toMatchObject({
          phase: "connected",
          generation: 1,
        });
      }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("times out repeated resume probes without retry backoff", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const harness = yield* makeHarness({
        probe: (attempt) =>
          attempt === 1
            ? Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never))
            : Effect.void,
      });
      const supervisor = yield* EnvironmentSupervisor.make(TARGET_ENTRY, {
        initiallyDesired: true,
      }).pipe(Effect.provide(harness.dependencies));
      yield* awaitState(supervisor.state, (state) => state.phase === "connected");
      yield* harness.wake("application-resumed");
      yield* Deferred.await(started);
      yield* harness.wake("application-resumed");
      yield* TestClock.adjust("3 seconds");
      const state = yield* awaitState(
        supervisor.state,
        (state) => state.phase === "connected" && state.generation === 2,
      );
      expect(state.attempt).toBe(1);
      expect(yield* Ref.get(harness.releaseCount)).toBe(1);
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("reconnects immediately when the session closes during a resume probe", () =>
    Effect.gen(function* () {
      const probeStarted = yield* Deferred.make<void>();
      const harness = yield* makeHarness({
        probe: (attempt) =>
          attempt === 1
            ? Deferred.succeed(probeStarted, undefined).pipe(Effect.andThen(Effect.never))
            : Effect.void,
      });
      const supervisor = yield* EnvironmentSupervisor.make(TARGET_ENTRY, {
        initiallyDesired: true,
      }).pipe(Effect.provide(harness.dependencies));

      yield* awaitState(supervisor.state, (state) => state.phase === "connected");
      yield* harness.wake("application-resumed");
      yield* Deferred.await(probeStarted);
      yield* harness.closeLatestSession();

      const reconnected = yield* awaitState(
        supervisor.state,
        (state) => state.phase === "connected" && state.generation === 2,
      );
      expect(reconnected.attempt).toBe(1);
      expect(yield* Ref.get(harness.sessionCount)).toBe(2);
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("reconnects immediately when the foreground liveness probe fails", () =>
    Effect.gen(function* () {
      const allowReconnect = yield* Deferred.make<void>();
      const harness = yield* makeHarness({
        prepare: (attempt) =>
          attempt === 2
            ? Deferred.await(allowReconnect).pipe(Effect.as(PREPARED_CONNECTION))
            : Effect.succeed(PREPARED_CONNECTION),
        probe: (attempt) =>
          attempt === 1 ? Effect.fail(transient("The live session is stale.")) : Effect.void,
      });
      const supervisor = yield* EnvironmentSupervisor.make(TARGET_ENTRY, {
        initiallyDesired: true,
      }).pipe(Effect.provide(harness.dependencies));

      yield* awaitState(supervisor.state, (state) => state.phase === "connected");
      yield* harness.wake("application-active");
      const reconnecting = yield* awaitState(
        supervisor.state,
        (state) => state.phase === "connecting",
      );
      expect(reconnecting.attempt).toBe(1);
      expect(Option.isNone(yield* SubscriptionRef.get(supervisor.session))).toBe(true);

      yield* Deferred.succeed(allowReconnect, undefined);
      yield* awaitState(
        supervisor.state,
        (state) => state.phase === "connected" && state.generation === 2 && state.attempt === 1,
      );

      expect(yield* Ref.get(harness.sessionCount)).toBe(2);
      expect(yield* Ref.get(harness.releaseCount)).toBe(1);
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("keeps normal backoff when a reconnect after a failed wake probe also fails", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        prepare: (attempt) =>
          attempt === 2 ? Effect.fail(transient()) : Effect.succeed(PREPARED_CONNECTION),
        probe: (attempt) =>
          attempt === 1 ? Effect.fail(transient("The live session is stale.")) : Effect.void,
      });
      const supervisor = yield* EnvironmentSupervisor.make(TARGET_ENTRY, {
        initiallyDesired: true,
      }).pipe(Effect.provide(harness.dependencies));

      yield* awaitState(supervisor.state, (state) => state.phase === "connected");
      yield* harness.wake("application-active");
      yield* awaitState(
        supervisor.state,
        (state) => state.phase === "backoff" && state.attempt === 1,
      );
      yield* TestClock.adjust("1999 millis");
      expect(yield* Ref.get(harness.prepareCount)).toBe(2);
      yield* TestClock.adjust("1 milli");
      yield* eventuallyState(
        supervisor.state,
        (state) => state.phase === "connected" && state.generation === 2,
      );

      expect(yield* Ref.get(harness.prepareCount)).toBe(3);
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("uses the full tolerance window for a stalled desktop foreground probe", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        probe: (attempt) => (attempt === 1 ? Effect.never : Effect.void),
      });
      const supervisor = yield* EnvironmentSupervisor.make(TARGET_ENTRY, {
        initiallyDesired: true,
      }).pipe(Effect.provide(harness.dependencies));

      yield* awaitState(supervisor.state, (state) => state.phase === "connected");
      yield* harness.wake("application-active");
      yield* TestClock.adjust("14999 millis");
      expect(yield* Ref.get(harness.sessionCount)).toBe(1);
      yield* TestClock.adjust("1 milli");
      yield* awaitState(
        supervisor.state,
        (state) => state.phase === "connected" && state.generation === 2 && state.attempt === 1,
      );

      expect(yield* Ref.get(harness.sessionCount)).toBe(2);
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("an explicit retry shortens a stalled desktop foreground probe", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        probe: (attempt) => (attempt === 1 ? Effect.never : Effect.void),
      });
      const supervisor = yield* EnvironmentSupervisor.make(TARGET_ENTRY, {
        initiallyDesired: true,
      }).pipe(Effect.provide(harness.dependencies));

      yield* awaitState(supervisor.state, (state) => state.phase === "connected");
      yield* harness.wake("application-active");
      yield* TestClock.adjust("5 seconds");
      yield* supervisor.retryNow;
      yield* TestClock.adjust("2999 millis");
      expect(yield* Ref.get(harness.sessionCount)).toBe(1);
      yield* TestClock.adjust("1 milli");
      yield* awaitState(
        supervisor.state,
        (state) => state.phase === "connected" && state.generation === 2 && state.attempt === 1,
      );

      expect(yield* Ref.get(harness.sessionCount)).toBe(2);
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("quickly times out a stalled mobile foreground liveness probe", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        probe: (attempt) => (attempt === 1 ? Effect.never : Effect.void),
      });
      const supervisor = yield* EnvironmentSupervisor.make(TARGET_ENTRY, {
        initiallyDesired: true,
      }).pipe(Effect.provide(harness.dependencies));

      yield* awaitState(supervisor.state, (state) => state.phase === "connected");
      yield* harness.wake("application-resumed");
      yield* TestClock.adjust("3 seconds");
      yield* awaitState(
        supervisor.state,
        (state) => state.phase === "connected" && state.generation === 2 && state.attempt === 1,
      );

      expect(yield* Ref.get(harness.sessionCount)).toBe(2);
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("honors an explicit disconnect while a foreground probe is stalled", () =>
    Effect.gen(function* () {
      const probeStarted = yield* Deferred.make<void>();
      const harness = yield* makeHarness({
        probe: () => Deferred.succeed(probeStarted, undefined).pipe(Effect.andThen(Effect.never)),
      });
      const supervisor = yield* EnvironmentSupervisor.make(TARGET_ENTRY, {
        initiallyDesired: true,
      }).pipe(Effect.provide(harness.dependencies));

      yield* awaitState(supervisor.state, (state) => state.phase === "connected");
      yield* harness.wake("application-active");
      yield* Deferred.await(probeStarted);
      yield* supervisor.disconnect;
      yield* awaitState(supervisor.state, (state) => state.phase === "available");

      expect(yield* Ref.get(harness.releaseCount)).toBe(1);
    }),
  );

  it.effect("explicit disconnect releases the session and returns to available", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const supervisor = yield* EnvironmentSupervisor.make(TARGET_ENTRY, {
        initiallyDesired: true,
      }).pipe(Effect.provide(harness.dependencies));

      yield* awaitState(supervisor.state, (state) => state.phase === "connected");
      yield* supervisor.disconnect;
      yield* awaitState(supervisor.state, (state) => state.phase === "available");

      expect(yield* Ref.get(harness.releaseCount)).toBe(1);
      expect(Option.isNone(yield* SubscriptionRef.get(supervisor.session))).toBe(true);
      expect(Option.isNone(yield* SubscriptionRef.get(supervisor.prepared))).toBe(true);
    }),
  );

  it.effect("does not lose an explicit disconnect among concurrent wakeup signals", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const supervisor = yield* EnvironmentSupervisor.make(TARGET_ENTRY, {
        initiallyDesired: true,
      }).pipe(Effect.provide(harness.dependencies));

      yield* awaitState(supervisor.state, (state) => state.phase === "connected");
      yield* Effect.all(
        [
          supervisor.disconnect,
          harness.wake("application-resumed"),
          harness.wake("application-active"),
          harness.wake("application-resumed"),
        ],
        { concurrency: "unbounded" },
      );
      yield* awaitState(supervisor.state, (state) => state.phase === "available");

      expect(yield* Ref.get(harness.releaseCount)).toBe(1);
      expect(Option.isNone(yield* SubscriptionRef.get(supervisor.session))).toBe(true);
    }),
  );
  it.effect(
    "keeps a manually preferred relay when a lower-priority direct route is reachable",
    () =>
      Effect.gen(function* () {
        const probed = yield* Deferred.make<void>();
        const harness = yield* makeHarness({
          checkRoute: () => Effect.succeed("answered"),
          probe: () => Deferred.succeed(probed, undefined).pipe(Effect.asVoid),
        });
        const supervisor = yield* EnvironmentSupervisor.make({
          ...RELAY_ROUTE,
          alternateRoutes: [LAN_ROUTE],
          enabled: true,
        }).pipe(Effect.provide(harness.dependencies));
        yield* supervisor.connect;
        yield* awaitState(supervisor.state, (state) => state.phase === "connected");
        expect(Option.getOrThrow(yield* SubscriptionRef.get(supervisor.prepared)).target).toEqual(
          RELAY_TARGET,
        );
        yield* harness.wake("application-resumed");
        yield* Deferred.await(probed);
        yield* TestClock.adjust("60 seconds");
        expect(Option.getOrThrow(yield* SubscriptionRef.get(supervisor.prepared)).target).toEqual(
          RELAY_TARGET,
        );
        expect(yield* Ref.get(harness.sessionCount)).toBe(1);
        expect(yield* Ref.get(harness.releaseCount)).toBe(0);
      }),
  );

  it.effect.each([LAN_ROUTE, TAILNET_ROUTE])(
    "switches from relay to a newly reachable preferred direct route: %#",
    (direct) =>
      Effect.gen(function* () {
        const reachable = yield* Ref.make(false);
        const harness = yield* makeHarness({
          prepare: (_attempt, target) =>
            target === direct.target
              ? Ref.get(reachable).pipe(
                  Effect.flatMap((available) =>
                    available
                      ? Effect.succeed(PREPARED_CONNECTION)
                      : Effect.fail(transient("Direct route unavailable")),
                  ),
                )
              : Effect.succeed(PREPARED_CONNECTION),
          checkRoute: (route) =>
            route.target === direct.target
              ? Ref.get(reachable).pipe(
                  Effect.map((available) => (available ? "answered" : "silent")),
                )
              : Effect.succeed("answered"),
        });
        const supervisor = yield* EnvironmentSupervisor.make({
          ...direct,
          alternateRoutes: [RELAY_ROUTE],
          enabled: true,
        }).pipe(Effect.provide(harness.dependencies));
        yield* supervisor.connect;
        yield* awaitState(supervisor.state, (state) => state.phase === "connected");
        expect(Option.getOrThrow(yield* SubscriptionRef.get(supervisor.prepared)).target).toEqual(
          RELAY_TARGET,
        );
        yield* Ref.set(reachable, true);
        yield* harness.wake("network-changed");
        yield* awaitState(
          supervisor.state,
          (state) => state.generation >= 2 && state.phase === "connected",
        );
        expect(Option.getOrThrow(yield* SubscriptionRef.get(supervisor.prepared)).target).toEqual(
          direct.target,
        );
        expect(yield* Ref.get(harness.releaseCount)).toBe(1);
      }),
  );

  it.effect.each(["application-resumed", "network-changed", "periodic"] as const)(
    "returns from Tailscale to LAN after %s",
    (trigger) =>
      Effect.gen(function* () {
        const lanReachable = yield* Ref.make(false);
        const harness = yield* makeHarness({
          prepare: (_attempt, target) =>
            target._tag === "BearerConnectionTarget" && target.connectionId === "lan"
              ? Ref.get(lanReachable).pipe(
                  Effect.flatMap((reachable) =>
                    reachable
                      ? Effect.succeed(PREPARED_CONNECTION)
                      : Effect.fail(transient("LAN unavailable")),
                  ),
                )
              : Effect.succeed(PREPARED_CONNECTION),
          checkRoute: (route) =>
            route.target._tag === "BearerConnectionTarget" && route.target.connectionId === "lan"
              ? Ref.get(lanReachable).pipe(
                  Effect.map((reachable) => (reachable ? "answered" : "silent")),
                )
              : Effect.succeed("answered"),
        });
        const entry: ConnectionCatalogEntry = {
          target: LAN_ROUTE.target,
          profile: LAN_ROUTE.profile,
          alternateRoutes: [TAILNET_ROUTE],
          enabled: true,
        };
        const supervisor = yield* EnvironmentSupervisor.make(entry).pipe(
          Effect.provide(harness.dependencies),
        );
        yield* supervisor.connect;
        yield* awaitState(supervisor.state, (state) => state.phase === "connected");
        expect(Option.getOrThrow(yield* SubscriptionRef.get(supervisor.prepared)).target).toEqual(
          TAILNET_TARGET,
        );
        yield* Ref.set(lanReachable, true);
        if (trigger === "periodic") yield* TestClock.adjust("60 seconds");
        else yield* harness.wake(trigger);
        yield* awaitState(
          supervisor.state,
          (state) => state.generation >= 2 && state.phase === "connected",
        );
        expect(Option.getOrThrow(yield* SubscriptionRef.get(supervisor.prepared)).target).toEqual(
          LAN_TARGET,
        );
      }),
  );
  it.effect("gives the last route its full setup time after slow route checks", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        checkRoute: () => Effect.sleep("15 seconds").pipe(Effect.as("silent" as const)),
        prepare: (_attempt, target) =>
          target === LAN_TARGET
            ? Effect.never
            : Effect.sleep("10 seconds").pipe(Effect.as(PREPARED_CONNECTION)),
      });
      const entry: ConnectionCatalogEntry = {
        ...LAN_ROUTE,
        alternateRoutes: [TAILNET_ROUTE],
        enabled: true,
      };
      const supervisor = yield* EnvironmentSupervisor.make(entry, { initiallyDesired: true }).pipe(
        Effect.provide(harness.dependencies),
      );
      yield* TestClock.adjust("40 seconds");
      yield* awaitState(supervisor.state, (state) => state.phase === "connected");
      expect(Option.getOrThrow(yield* SubscriptionRef.get(supervisor.prepared)).target).toEqual(
        TAILNET_TARGET,
      );
    }),
  );

  it.effect(
    "gives the next route its own snapshot budget after a route fails while synchronizing",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeHarness({
          checkRoute: () => Effect.succeed("answered"),
          // The LAN session fails 50 seconds into its snapshot; Tailscale needs 40.
          ready: (attempt) =>
            attempt === 1
              ? Effect.sleep("50 seconds").pipe(Effect.andThen(Effect.fail(transient())))
              : Effect.sleep("40 seconds"),
        });
        const entry: ConnectionCatalogEntry = {
          ...LAN_ROUTE,
          alternateRoutes: [TAILNET_ROUTE],
          enabled: true,
        };
        const supervisor = yield* EnvironmentSupervisor.make(entry, {
          initiallyDesired: true,
        }).pipe(Effect.provide(harness.dependencies));

        yield* awaitState(
          supervisor.state,
          (state) => state.phase === "connecting" && state.stage === "synchronizing",
        );
        yield* TestClock.adjust("50 seconds");
        yield* TestClock.adjust("40 seconds");
        yield* awaitState(supervisor.state, (state) => state.phase === "connected");
        expect(Option.getOrThrow(yield* SubscriptionRef.get(supervisor.prepared)).target).toEqual(
          TAILNET_TARGET,
        );
        expect(yield* Ref.get(harness.prepareCount)).toBe(2);
        expect(yield* Ref.get(harness.releaseCount)).toBe(1);
      }),
  );

  it.effect("keeps the fallback connected while a failed preferred route cools down", () =>
    Effect.gen(function* () {
      const lanAnswers = yield* Ref.make(false);
      const harness = yield* makeHarness({
        checkRoute: (route) =>
          route.target === LAN_TARGET
            ? Ref.get(lanAnswers).pipe(Effect.map((answers) => (answers ? "answered" : "silent")))
            : Effect.succeed("answered"),
        prepare: (_attempt, target) =>
          target === LAN_TARGET
            ? Effect.fail(transient("LAN socket refused"))
            : Effect.succeed(PREPARED_CONNECTION),
      });
      const entry: ConnectionCatalogEntry = {
        ...LAN_ROUTE,
        alternateRoutes: [TAILNET_ROUTE],
        enabled: true,
      };
      const supervisor = yield* EnvironmentSupervisor.make(entry, { initiallyDesired: true }).pipe(
        Effect.provide(harness.dependencies),
      );
      yield* awaitState(supervisor.state, (state) => state.phase === "connected");
      yield* Ref.set(lanAnswers, true);
      yield* TestClock.adjust("60 seconds");
      yield* awaitState(
        supervisor.state,
        (state) => state.phase === "connected" && state.generation === 2,
      );
      expect(Option.getOrThrow(yield* SubscriptionRef.get(supervisor.prepared)).target).toEqual(
        TAILNET_TARGET,
      );
      const prepares = yield* Ref.get(harness.prepareCount);
      yield* TestClock.adjust("60 seconds");
      yield* Effect.yieldNow;
      expect(yield* Ref.get(harness.prepareCount)).toBe(prepares);
      expect(yield* SubscriptionRef.get(supervisor.state)).toMatchObject({
        phase: "connected",
        generation: 2,
      });
      yield* TestClock.adjust("4 minutes");
      yield* awaitState(
        supervisor.state,
        (state) => state.phase === "connected" && state.generation === 3,
      );
    }),
  );
});
