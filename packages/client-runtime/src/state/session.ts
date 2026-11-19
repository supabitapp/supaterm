import { pipe } from "effect/Function";
import {
  type AuthEnvironmentScope,
  type AuthSessionState,
  EnvironmentAuthInvalidError,
  type EnvironmentId,
  EnvironmentOperationForbiddenError,
  EnvironmentScopeRequiredError,
  type ServerConfig,
  sessionGrantsScope,
} from "@supaterm/contracts";
import * as Cause from "effect/Cause";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { HttpClient } from "effect/http";
import { AsyncResult, Atom } from "effect/reactivity";

import * as EnvironmentRegistry from "../connection/registry.ts";
import type { ConnectionRoute } from "../connection/catalog.ts";
import { mapRemoteEnvironmentError } from "../connection/errors.ts";
import {
  connectionRouteLatencyLabel,
  measureConnectionRouteLatency,
  type ConnectionRouteLatency,
} from "../connection/routeLatency.ts";
import { connectionRouteId, relayRouteIdentity } from "../connection/routes.ts";
import type { PreparedConnection } from "../connection/model.ts";
import { RelayGateway, type RelayTransport } from "../relay/gateway.ts";
import * as EnvironmentSupervisor from "../connection/supervisor.ts";
import {
  RemoteEnvironmentAuthUndeclaredStatusError,
  type RemoteEnvironmentRequestError,
} from "../rpc/http.ts";
import type { RpcSession } from "../rpc/session.ts";
import { safeErrorLogAttributes } from "../errors/safeLog.ts";
import { executeAuthenticatedEnvironmentHttpRequest } from "./environmentHttpAuth.ts";
import { followStreamInEnvironment } from "./environmentStreams.ts";

/** @public Required to name the error in consumers' inferred session results. */
export class SessionHttpClientUnavailable extends Data.TaggedError(
  "SessionHttpClientUnavailable",
) {}

function initialConfigOption<E>(initialConfig: Effect.Effect<ServerConfig, E>) {
  return initialConfig.pipe(
    Effect.asSome,
    Effect.catch((error) =>
      Effect.logWarning("Could not load the initial environment configuration.").pipe(
        Effect.annotateLogs({ ...safeErrorLogAttributes(error) }),
        Effect.as(Option.none<ServerConfig>()),
      ),
    ),
  );
}

const DEFAULT_SESSION_STATE_TIMEOUT_MS = 6_000;
const MAX_SESSION_STATE_TIMEOUT_MS = 60_000;

const SESSION_STATE_RETRY_BASE_MS = 2_000;
const SESSION_STATE_RETRY_MAX_MS = 60_000;

const isSessionRejectionError = Schema.is(
  Schema.Union([
    EnvironmentAuthInvalidError,
    EnvironmentScopeRequiredError,
    EnvironmentOperationForbiddenError,
  ]),
);

/**
 * True only when the host said no: its session lacks the scope, or it rejected the credential.
 * A lookup that is still pending or failed on the network is not a denial.
 */
export function sessionDeniesScope(
  result: AsyncResult.AsyncResult<AuthSessionState, unknown>,
  scope: AuthEnvironmentScope,
) {
  if (result._tag === "Success") return !sessionGrantsScope(result.value, scope);
  return result._tag === "Failure" && isSessionRejection(result.cause);
}

function isSessionRejection(cause: Cause.Cause<unknown>) {
  const error = Option.getOrNull(Cause.findErrorOption(cause));
  if (error instanceof RemoteEnvironmentAuthUndeclaredStatusError) {
    return error.status === 401 || error.status === 403;
  }
  return isSessionRejectionError(error);
}

/**
 * Read the granted scopes of this client's session on one environment via its
 * `/api/auth/session` endpoint, using the connection's authentication method.
 */
export const fetchEnvironmentSessionState = Effect.fn(
  "clientRuntime.state.fetchEnvironmentSessionState",
)(function* (input: { readonly prepared: PreparedConnection; readonly timeoutMs?: number }) {
  const request: (
    timeoutMs: number,
  ) => Effect.Effect<AuthSessionState, RemoteEnvironmentRequestError, HttpClient.HttpClient> = (
    timeoutMs: number,
  ) =>
    executeAuthenticatedEnvironmentHttpRequest({
      ...input,
      group: "auth",
      url: (urls) => urls.session(),
      timeoutMs,
      request: ({ client, headers }) => client.session({ headers }),
    }).pipe(
      Effect.catchTags({
        RemoteEnvironmentAuthTimeoutError: (error) => {
          const nextTimeoutMs = Math.min(timeoutMs * 2, MAX_SESSION_STATE_TIMEOUT_MS);
          return nextTimeoutMs > timeoutMs ? request(nextTimeoutMs) : Effect.fail(error);
        },
      }),
    );
  return yield* request(input.timeoutMs ?? DEFAULT_SESSION_STATE_TIMEOUT_MS);
});

function makeEnvironmentSessionAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | R, E>,
) {
  const initialConfigAtom = Atom.family((environmentId: EnvironmentId) =>
    runtime.atom(
      followStreamInEnvironment(
        environmentId,
        Stream.unwrap(
          EnvironmentSupervisor.EnvironmentSupervisor.pipe(
            Effect.map((supervisor) =>
              SubscriptionRef.changes(supervisor.session).pipe(
                Stream.mapEffect(
                  Option.match({
                    onNone: () => Effect.succeed(Option.none<ServerConfig>()),
                    onSome: (session) => initialConfigOption(session.initialConfig),
                  }),
                ),
              ),
            ),
          ),
        ),
      ),
      { initialValue: Option.none() },
    ),
  );

  const initialConfigValueAtom = Atom.family((environmentId: EnvironmentId) =>
    Atom.make((get) =>
      pipe(
        get(initialConfigAtom(environmentId)),
        AsyncResult.value,
        Option.flatten,
        Option.getOrNull,
      ),
    ).pipe(Atom.withLabel(`environment-config-value:${environmentId}`)),
  );

  const preparedConnectionAtom = Atom.family((environmentId: EnvironmentId) =>
    runtime.atom(
      followStreamInEnvironment(
        environmentId,
        Stream.unwrap(
          EnvironmentSupervisor.EnvironmentSupervisor.pipe(
            Effect.map((supervisor) => SubscriptionRef.changes(supervisor.prepared)),
          ),
        ),
      ),
      { initialValue: Option.none<PreparedConnection>() },
    ),
  );

  const preparedConnectionValueAtom = Atom.family((environmentId: EnvironmentId) =>
    Atom.make((get) =>
      AsyncResult.getOrElse(get(preparedConnectionAtom(environmentId)), () =>
        Option.none<PreparedConnection>(),
      ),
    ).pipe(Atom.withLabel(`environment-prepared-connection:${environmentId}`)),
  );

  const transportSessionAtom = Atom.family((environmentId: EnvironmentId) =>
    runtime.atom(
      followStreamInEnvironment(
        environmentId,
        Stream.unwrap(
          EnvironmentSupervisor.EnvironmentSupervisor.pipe(
            Effect.map((supervisor) => SubscriptionRef.changes(supervisor.session)),
          ),
        ),
      ),
      { initialValue: Option.none() },
    ),
  );

  const sessionStateAtom = Atom.family((environmentId: EnvironmentId) => {
    let consecutiveFailures = 0;
    let backoffConnection: RpcSession | null = null;
    return runtime
      .atom((get) => {
        const prepared = Option.getOrNull(get(preparedConnectionValueAtom(environmentId)));
        const connection = AsyncResult.getOrElse(get(transportSessionAtom(environmentId)), () =>
          Option.none(),
        );
        if (prepared === null || Option.isNone(connection)) {
          return Effect.never;
        }
        if (connection.value !== backoffConnection) {
          backoffConnection = connection.value;
          consecutiveFailures = 0;
        }
        return Effect.gen(function* () {
          const client = yield* Effect.serviceOption(HttpClient.HttpClient);
          if (Option.isNone(client)) return yield* new SessionHttpClientUnavailable();
          return yield* fetchEnvironmentSessionState({ prepared }).pipe(
            Effect.retry({
              while: (error) =>
                error._tag !== "RemoteEnvironmentAuthTimeoutError" &&
                mapRemoteEnvironmentError(error)._tag === "ConnectionTransientError",
              schedule: Schedule.exponential("1 second"),
              times: 3,
            }),
            Effect.provideService(HttpClient.HttpClient, client.value),
          );
        }).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              consecutiveFailures = 0;
            }),
          ),
          Effect.tapError(() => {
            const delayMs = Math.min(
              SESSION_STATE_RETRY_BASE_MS * 2 ** consecutiveFailures,
              SESSION_STATE_RETRY_MAX_MS,
            );
            consecutiveFailures += 1;
            return Effect.sleep(delayMs).pipe(
              Effect.andThen(Effect.sync(() => get.refreshSelf())),
              Effect.forkScoped,
            );
          }),
        );
      })
      .pipe(
        Atom.swr({ staleTime: 30_000, revalidateOnMount: true }),
        Atom.setIdleTTL(5 * 60_000),
        Atom.withLabel(`environment-session-state:${environmentId}`),
      );
  });

  const sessionStateValueAtom = Atom.family((environmentId: EnvironmentId) =>
    Atom.make(
      (get) =>
        (AsyncResult.getOrElse(get(sessionStateAtom(environmentId)), () => null) ??
          null) satisfies AuthSessionState | null,
    ).pipe(Atom.withLabel(`environment-session-state-value:${environmentId}`)),
  );

  const routeLatencyAtoms = Atom.family((route: ConnectionRoute) => {
    const resultAtom = runtime
      .atom((get) => {
        if (route.target._tag !== "SshConnectionTarget") {
          return Effect.gen(function* () {
            const client = yield* Effect.serviceOption(HttpClient.HttpClient);
            if (Option.isNone(client)) return yield* new SessionHttpClientUnavailable();
            return yield* measureConnectionRouteLatency({ route }).pipe(
              Effect.provideService(HttpClient.HttpClient, client.value),
            );
          });
        }
        const environmentId = route.target.environmentId;
        const config = get(initialConfigValueAtom(environmentId));
        const prepared = get(preparedConnectionValueAtom(environmentId));
        if (
          config === null ||
          Option.isNone(prepared) ||
          connectionRouteId(prepared.value.target) !== connectionRouteId(route.target)
        ) {
          return Effect.succeed<ConnectionRouteLatency>({ status: "unmeasured" });
        }
        return EnvironmentRegistry.EnvironmentRegistry.pipe(
          Effect.flatMap((registry) =>
            registry.run(
              environmentId,
              Effect.gen(function* () {
                const supervisor = yield* EnvironmentSupervisor.EnvironmentSupervisor;
                const session = yield* SubscriptionRef.get(supervisor.session);
                const current = yield* SubscriptionRef.get(supervisor.prepared);
                if (
                  Option.isNone(session) ||
                  Option.isNone(current) ||
                  connectionRouteId(current.value.target) !== connectionRouteId(route.target)
                ) {
                  return { status: "unmeasured" } as const;
                }
                const client = yield* Effect.serviceOption(HttpClient.HttpClient);
                if (Option.isNone(client)) return yield* new SessionHttpClientUnavailable();
                return yield* measureConnectionRouteLatency({
                  route,
                  sshProbe: session.value.probe,
                }).pipe(Effect.provideService(HttpClient.HttpClient, client.value));
              }),
            ),
          ),
        );
      })
      .pipe(
        Atom.swr({ staleTime: 30_000, revalidateOnMount: true }),
        Atom.setIdleTTL(30_000),
        Atom.withLabel(
          `environment-route-latency:${route.target.environmentId}:${connectionRouteId(route.target)}`,
        ),
      );
    const labelAtom = Atom.make((get) => {
      const result = get(resultAtom);
      return connectionRouteLatencyLabel(
        result.waiting || result._tag === "Initial"
          ? null
          : AsyncResult.getOrElse(result, () => ({
              status: "unreachable",
            })),
      );
    });
    return { resultAtom, labelAtom };
  });

  const relayGatewayAtom = runtime.atom(Effect.serviceOption(RelayGateway));
  const relayTransportAtom = Atom.family((identity: string) =>
    Atom.make((get) => {
      const gateway = Option.getOrUndefined(
        Option.flatten(AsyncResult.value(get(relayGatewayAtom))),
      );
      if (gateway === undefined) return undefined;
      get.addFinalizer(gateway.subscribe(() => get.setSelf(gateway.via(identity))));
      return gateway.via(identity);
    }).pipe(Atom.withLabel(`relay-transport:${identity}`)),
  );
  const noRelayTransportAtom = Atom.make<RelayTransport | undefined>(undefined).pipe(
    Atom.withLabel("relay-transport:none"),
  );
  const relayRouteTransportAtom = (route: ConnectionRoute) => {
    const identity = relayRouteIdentity(route);
    return identity === null ? noRelayTransportAtom : relayTransportAtom(identity);
  };

  return {
    initialConfigAtom,
    initialConfigValueAtom,
    preparedConnectionAtom,
    preparedConnectionValueAtom,
    sessionStateAtom,
    sessionStateValueAtom,
    routeLatencyAtoms,
    relayRouteTransportAtom,
  };
}

const sessionAtomsByRuntime = new WeakMap<object, ReturnType<typeof makeEnvironmentSessionAtoms>>();

export function createEnvironmentSessionAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | R, E>,
): ReturnType<typeof makeEnvironmentSessionAtoms<R, E>>;
export function createEnvironmentSessionAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | R, E>,
) {
  const existing = sessionAtomsByRuntime.get(runtime);
  if (existing)
    return existing as ReturnType<typeof makeEnvironmentSessionAtoms<R, E>> satisfies ReturnType<
      typeof makeEnvironmentSessionAtoms<R, E>
    >;
  const atoms = makeEnvironmentSessionAtoms(runtime);
  sessionAtomsByRuntime.set(runtime, atoms);
  return atoms satisfies ReturnType<typeof makeEnvironmentSessionAtoms<R, E>>;
}
