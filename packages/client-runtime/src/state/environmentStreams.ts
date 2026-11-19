import type { EnvironmentId as EnvironmentIdType } from "@supaterm/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as EnvironmentRegistry from "../connection/registry.ts";
import type * as EnvironmentSupervisor from "../connection/supervisor.ts";

export function runStreamInEnvironment<A, E, R>(
  environmentId: EnvironmentIdType,
  stream: Stream.Stream<A, E, R>,
) {
  return Stream.unwrap(
    EnvironmentRegistry.EnvironmentRegistry.pipe(
      Effect.map((registry) => registry.runStream(environmentId, stream)),
    ),
  );
}

export function followStreamInEnvironment<A, E, R>(
  environmentId: EnvironmentIdType,
  stream: Stream.Stream<A, E, R>,
): Stream.Stream<
  A,
  E,
  EnvironmentRegistry.EnvironmentRegistry | Exclude<R, EnvironmentSupervisor.EnvironmentSupervisor>
>;
export function followStreamInEnvironment<A, E, R>(
  environmentId: EnvironmentIdType,
  stream: Stream.Stream<A, E, R>,
) {
  return Stream.unwrap(
    EnvironmentRegistry.EnvironmentRegistry.pipe(
      Effect.map((registry) => registry.followStream(environmentId, stream)),
    ),
  ) satisfies Stream.Stream<
    A,
    E,
    | EnvironmentRegistry.EnvironmentRegistry
    | Exclude<R, EnvironmentSupervisor.EnvironmentSupervisor>
  >;
}
