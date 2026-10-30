import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Metric from "effect/Metric";
import { dual } from "effect/Function";

import { compactMetricAttributes, outcomeFromExit } from "./Attributes.ts";

export const rpcRequestsTotal = Metric.counter("supaterm_rpc_requests_total", {
  description: "Total RPC requests handled by the websocket RPC server.",
});

export const rpcRequestDuration = Metric.timer("supaterm_rpc_request_duration", {
  description: "RPC request handling duration.",
});

export const orchestrationCommandsTotal = Metric.counter("supaterm_orchestration_commands_total", {
  description: "Total orchestration commands dispatched, by outcome.",
});

export const orchestrationCommandDuration = Metric.timer(
  "supaterm_orchestration_command_duration",
  {
    description: "Orchestration command handling duration, excluding thread dispatch lock wait.",
  },
);

export const orchestrationEffectClaimsTotal = Metric.counter(
  "supaterm_orchestration_effect_claims_total",
  {
    description: "Total completed orchestration effect outbox claim attempts by result.",
  },
);

export const orchestrationEffectQueueWait = Metric.timer(
  "supaterm_orchestration_effect_queue_wait",
  {
    description:
      "Time from an orchestration effect's temporal availability until claim, including same-thread blocking.",
  },
);

// OTLP carries the unit, and Prometheus names the series by it: a unitless gauge gains `_ratio`.
export const serverResidentBytes = Metric.gauge("supaterm_server_resident_bytes", {
  description: "Resident memory of the server process.",
  attributes: { unit: "By" },
});

export const serverHeapUsedBytes = Metric.gauge("supaterm_server_heap_used_bytes", {
  description: "JavaScript heap in use by the server process.",
  attributes: { unit: "By" },
});

export const serverCpuUtilization = Metric.gauge("supaterm_server_cpu_utilization", {
  description: "CPU time the server used per second over the last sample; 1 is one full core.",
});

export const serverEventLoopUtilization = Metric.gauge("supaterm_server_event_loop_utilization", {
  description: "Share of the last sample the server's event loop spent busy.",
});

export const serverEventLoopDelayMax = Metric.gauge("supaterm_server_event_loop_delay_max", {
  description: "Longest event loop delay over the last sample.",
  attributes: { unit: "ms" },
});

export const runsTotal = Metric.counter("supaterm_runs_total", {
  description: "Runs that finished, by outcome. A later rollback does not count again.",
});

export const runDuration = Metric.timer("supaterm_run_duration", {
  description: "Wall time of a run, from when it started to its terminal status.",
});

export const runQueueWait = Metric.timer("supaterm_run_queue_wait", {
  description: "Time a run waited between being requested and starting.",
});

export const gitCommandsTotal = Metric.counter("supaterm_git_commands_total", {
  description: "Total git commands executed by the server runtime.",
});

export const gitCommandDuration = Metric.timer("supaterm_git_command_duration", {
  description: "Git command execution duration.",
});

export const terminalSessionsTotal = Metric.counter("supaterm_terminal_sessions_total", {
  description: "Total terminal sessions started.",
});

export const terminalRestartsTotal = Metric.counter("supaterm_terminal_restarts_total", {
  description: "Total terminal restart requests handled.",
});

export const metricAttributes = (
  attributes: Readonly<Record<string, unknown>>,
): ReadonlyArray<[string, string]> => Object.entries(compactMetricAttributes(attributes));

export const increment = (
  metric: Metric.Metric<number, unknown>,
  attributes: Readonly<Record<string, unknown>>,
  amount = 1,
) => Metric.update(Metric.withAttributes(metric, metricAttributes(attributes)), amount);

export interface WithMetricsOptions {
  readonly counter?: Metric.Metric<number, unknown>;
  readonly timer?: Metric.Metric<Duration.Duration, unknown>;
  readonly attributes?:
    | Readonly<Record<string, unknown>>
    | (() => Readonly<Record<string, unknown>>);
  readonly outcomeAttributes?: (
    outcome: ReturnType<typeof outcomeFromExit>,
  ) => Readonly<Record<string, unknown>>;
}

const recordMetrics =
  /* Instrumentation must not create its own span for every recorded operation. */
  Effect.fnUntraced(function* (
    options: WithMetricsOptions,
    startedAt: bigint,
    exit: Exit.Exit<unknown, unknown>,
  ) {
    const duration = Duration.nanos((yield* Clock.monotonicTimeNanos) - startedAt);
    const baseAttributes =
      typeof options.attributes === "function" ? options.attributes() : (options.attributes ?? {});

    if (options.timer) {
      yield* Metric.update(
        Metric.withAttributes(options.timer, metricAttributes(baseAttributes)),
        duration,
      );
    }

    if (options.counter) {
      const outcome = outcomeFromExit(exit);
      yield* Metric.update(
        Metric.withAttributes(
          options.counter,
          metricAttributes({
            ...baseAttributes,
            outcome,
            ...(options.outcomeAttributes ? options.outcomeAttributes(outcome) : {}),
          }),
        ),
        1,
      );
    }
  });

// Monotonic timing ignores clock corrections; exit finalizers count interruptions.
const withMetricsImpl = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  options: WithMetricsOptions,
): Effect.Effect<A, E, R> =>
  Effect.flatMap(Clock.monotonicTimeNanos, (startedAt) =>
    Effect.onExit(effect, (exit) => recordMetrics(options, startedAt, exit)),
  );

export const withMetrics: {
  (
    options: WithMetricsOptions,
  ): <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
  <A, E, R>(effect: Effect.Effect<A, E, R>, options: WithMetricsOptions): Effect.Effect<A, E, R>;
} = dual(2, withMetricsImpl);

export const withCommandMetrics = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  command: { readonly type: string },
): Effect.Effect<A, E, R> =>
  withMetrics(effect, {
    counter: orchestrationCommandsTotal,
    timer: orchestrationCommandDuration,
    attributes: { commandType: command.type },
  });

export const secretRequestsTotal = Metric.counter("supaterm_secret_requests_total", {
  description: "Private secret requests by outcome.",
});
