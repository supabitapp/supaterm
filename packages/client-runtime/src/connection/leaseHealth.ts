import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import type * as Scope from "effect/Scope";

import * as ConnectionDriver from "./driver.ts";
import { ConnectionTransientError, type ConnectionAttemptError } from "./model.ts";
import type { ConnectionRouteKind } from "./routes.ts";

type ProbeReason = "foreground" | "resume" | "long-resume" | "retry" | "offline" | "network-change";

export type Event =
  | { readonly _tag: "Probe"; readonly reason: ProbeReason }
  | { readonly _tag: "Ignore" }
  | { readonly _tag: "Suspend" }
  | { readonly _tag: "Disconnect" }
  | { readonly _tag: "Reconnect" };

export type RetryPolicy = "backoff" | "immediate" | "while-offline";
export type Phase = "idle" | "probing";

export type Outcome =
  | { readonly _tag: "Disconnected" }
  | { readonly _tag: "Reconnect" }
  | {
      readonly _tag: "Failed";
      readonly cause: Cause.Cause<ConnectionAttemptError>;
      readonly retry: RetryPolicy;
    };

type SocketCheck =
  | { readonly _tag: "Inactive" }
  | { readonly _tag: "Checking" | "Recheck"; readonly fiber: Fiber.Fiber<"silent" | "alive"> };

interface ProbeState {
  readonly probe: Fiber.Fiber<void, ConnectionAttemptError>;
  readonly deadline: bigint;
  readonly resume: "none" | "short" | "long";
  readonly socket: SocketCheck;
}

type ProbeOutcome = Outcome | { readonly _tag: "Healthy" } | { readonly _tag: "Suspended" };

interface Options<Signal> {
  readonly label: string;
  readonly routeKind: ConnectionRouteKind | undefined;
  readonly readSignal: Effect.Effect<Signal>;
  readonly handleSignal: (signal: Signal, phase: Phase) => Effect.Effect<Event>;
}

const answersQuickly = (kind: ConnectionRouteKind | undefined) =>
  kind === "loopback" || kind === "lan";

function probeTimeoutNanos(reason: ProbeReason, routeKind: ConnectionRouteKind | undefined) {
  const timeout =
    reason === "foreground" ||
    ((reason === "resume" || reason === "network-change") && !answersQuickly(routeKind))
      ? 15_000
      : 3_000;
  return BigInt(timeout) * 1_000_000n;
}

function resumed(current: ProbeState["resume"], reason: ProbeReason): ProbeState["resume"] {
  if (reason === "long-resume") return "long";
  return reason === "resume" && current === "none" ? "short" : current;
}

const failed = Effect.fnUntraced(function* (
  cause: Cause.Cause<ConnectionAttemptError>,
  retry: RetryPolicy,
) {
  if (Cause.hasInterrupts(cause)) return yield* Effect.interrupt;
  return { _tag: "Failed", cause, retry } as const;
});

const awaitSilentSocket = Effect.fn("EnvironmentSupervisor.awaitSilentSocket")(function* (
  lease: ConnectionDriver.EnvironmentConnectionLease,
  routeKind: ConnectionRouteKind | undefined,
) {
  const driver = yield* ConnectionDriver.ConnectionDriver;
  const startedAt = yield* Clock.monotonicTimeNanos;
  yield* Effect.sleep("500 millis");
  const configLoaded = yield* lease.session.initialConfig.pipe(
    Effect.as(true),
    Effect.catchCause(() => Effect.succeed(false)),
  );
  if (!configLoaded) return yield* Effect.never;
  const framesBefore = yield* lease.session.inboundFrames;
  const socketSilent = lease.session.inboundFrames.pipe(
    Effect.map((frames) => frames === framesBefore),
  );
  while ((yield* driver.checkHost(lease.prepared)) !== "answered") {
    if (!(yield* socketSilent)) return "alive" as const;
    yield* Effect.sleep("1 second");
  }
  if (!answersQuickly(routeKind)) {
    const remaining = 2_500_000_000n - ((yield* Clock.monotonicTimeNanos) - startedAt);
    if (remaining > 0n) yield* Effect.sleep(Duration.nanos(remaining));
  }
  return (yield* socketSilent) ? ("silent" as const) : ("alive" as const);
});

const probe = Effect.fnUntraced(function* <Signal>(
  lease: ConnectionDriver.EnvironmentConnectionLease,
  options: Options<Signal>,
  reason: ProbeReason,
): Effect.fn.Return<ProbeOutcome, never, ConnectionDriver.ConnectionDriver | Scope.Scope> {
  const startCheck = Effect.forkScoped(awaitSilentSocket(lease, options.routeKind)).pipe(
    Effect.map((fiber): SocketCheck => ({ _tag: "Checking", fiber })),
  );
  let state: ProbeState = {
    probe: yield* Effect.forkScoped(lease.session.probe),
    deadline: (yield* Clock.monotonicTimeNanos) + probeTimeoutNanos(reason, options.routeKind),
    resume: resumed("none", reason),
    socket: reason === "foreground" ? { _tag: "Inactive" } : yield* startCheck,
  };
  for (;;) {
    const remaining = state.deadline - (yield* Clock.monotonicTimeNanos);
    const retry = state.resume === "none" ? "immediate" : "while-offline";
    const observed = yield* Effect.raceAllFirst([
      lease.session.closed,
      Fiber.await(state.probe).pipe(
        Effect.map((exit) => ({ _tag: "ProbeFinished" as const, exit })),
      ),
      options.readSignal.pipe(Effect.map((signal) => ({ _tag: "Signal" as const, signal }))),
      Effect.sleep(Duration.nanos(remaining > 0n ? remaining : 0n)).pipe(
        Effect.as({ _tag: "TimedOut" as const }),
      ),
      (state.socket._tag === "Inactive" ? Effect.never : Fiber.join(state.socket.fiber)).pipe(
        Effect.map((result) => ({ _tag: "SocketChecked" as const, result })),
      ),
    ]).pipe(Effect.catchCause((cause) => failed(cause, retry)));
    const event =
      observed._tag === "Signal"
        ? yield* options
            .handleSignal(observed.signal, "probing")
            .pipe(Effect.catchCause((cause) => failed(cause, retry)))
        : observed;
    switch (event._tag) {
      case "Failed":
      case "Reconnect":
        return event;
      case "Disconnect":
        return { _tag: "Disconnected" };
      case "Suspend":
        return { _tag: "Suspended" };
      case "ProbeFinished":
        return Exit.isSuccess(event.exit)
          ? { _tag: "Healthy" }
          : yield* failed(event.exit.cause, retry);
      case "TimedOut":
        return state.resume === "long"
          ? { _tag: "Reconnect" }
          : yield* failed(
              Cause.fail(
                new ConnectionTransientError({
                  reason: "timeout",
                  detail: `${options.label} did not respond to a connection health check.`,
                }),
              ),
              retry,
            );
      case "SocketChecked":
        if (event.result === "silent") return { _tag: "Reconnect" };
        state = {
          probe: state.probe,
          deadline: state.deadline,
          resume: state.resume,
          socket: state.socket._tag === "Recheck" ? yield* startCheck : { _tag: "Inactive" },
        };
        break;
      case "Probe": {
        const deadline =
          (yield* Clock.monotonicTimeNanos) + probeTimeoutNanos(event.reason, options.routeKind);
        const socket =
          event.reason === "foreground"
            ? state.socket
            : state.socket._tag === "Inactive"
              ? yield* startCheck
              : { fiber: state.socket.fiber, _tag: "Recheck" as const };
        state = {
          probe: state.probe,
          deadline: deadline < state.deadline ? deadline : state.deadline,
          resume: resumed(state.resume, event.reason),
          socket,
        };
        break;
      }
      case "Ignore":
        break;
    }
  }
}, Effect.scoped);

export const monitor = Effect.fnUntraced(function* <Signal>(
  lease: ConnectionDriver.EnvironmentConnectionLease,
  options: Options<Signal>,
): Effect.fn.Return<Outcome, never, ConnectionDriver.ConnectionDriver> {
  for (;;) {
    const observed = yield* Effect.raceFirst(
      lease.session.closed,
      options.readSignal.pipe(Effect.map((signal) => ({ _tag: "Signal" as const, signal }))),
    ).pipe(Effect.catchCause((cause) => failed(cause, "backoff")));
    const event =
      observed._tag === "Signal"
        ? yield* options
            .handleSignal(observed.signal, "idle")
            .pipe(Effect.catchCause((cause) => failed(cause, "backoff")))
        : observed;
    switch (event._tag) {
      case "Failed":
      case "Reconnect":
        return event;
      case "Disconnect":
        return { _tag: "Disconnected" };
      case "Probe": {
        const result = yield* probe(lease, options, event.reason);
        if (result._tag !== "Healthy" && result._tag !== "Suspended") return result;
        break;
      }
      case "Ignore":
      case "Suspend":
        break;
    }
  }
});
