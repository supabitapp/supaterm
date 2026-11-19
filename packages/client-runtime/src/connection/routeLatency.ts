import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import { FetchHttpClient } from "effect/http";

import type { ConnectionRoute } from "./catalog.ts";
import { leaseRouteOrigin, ROUTE_CHECK_TIMEOUT_MS } from "./driver.ts";
import type { ConnectionAttemptError } from "./model.ts";
import { routeHttpBaseUrl } from "./routes.ts";
import { fetchRemoteEnvironmentDescriptor } from "../environment/descriptor.ts";

export type ConnectionRouteLatency =
  | { readonly status: "reachable"; readonly latencyMs: number }
  | { readonly status: "unreachable" }
  | { readonly status: "unmeasured" };

/** Checks direct addresses without credentials; SSH uses only an already active session. */
export const measureConnectionRouteLatency = Effect.fn("connection.measureRouteLatency")(
  function* (input: {
    readonly route: ConnectionRoute;
    readonly sshProbe?: Effect.Effect<void, ConnectionAttemptError>;
  }) {
    const httpBaseUrl = routeHttpBaseUrl(input.route);
    if (httpBaseUrl === null && input.sshProbe === undefined) {
      return { status: "unmeasured" } as const;
    }
    const probe =
      httpBaseUrl === null
        ? input.sshProbe!.pipe(
            Effect.as(true),
            Effect.orElseSucceed(() => false),
          )
        : leaseRouteOrigin(input.route, httpBaseUrl).pipe(
            Effect.flatMap((origin) =>
              fetchRemoteEnvironmentDescriptor({
                httpBaseUrl: origin,
                timeoutMs: ROUTE_CHECK_TIMEOUT_MS,
              }),
            ),
            Effect.map(
              (descriptor) => descriptor.environmentId === input.route.target.environmentId,
            ),
            Effect.provideService(FetchHttpClient.RequestInit, {
              cache: "no-store",
              credentials: "omit",
            }),
            Effect.orElseSucceed(() => false),
            Effect.scoped,
          );
    const [duration, answered] = yield* probe.pipe(
      Effect.timeoutOrElse({
        duration: ROUTE_CHECK_TIMEOUT_MS,
        orElse: () => Effect.succeed(false),
      }),
      Effect.timed,
    );
    return answered
      ? ({ status: "reachable", latencyMs: Math.round(Duration.toMillis(duration)) } as const)
      : ({ status: "unreachable" } as const);
  },
);

export function connectionRouteLatencyLabel(latency: ConnectionRouteLatency | null): string {
  if (latency === null) return "Checking…";
  switch (latency.status) {
    case "reachable":
      return `${latency.latencyMs} ms`;
    case "unreachable":
      return "Unreachable";
    case "unmeasured":
      return "Not measured";
  }
}
