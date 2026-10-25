import {
  type ServerConfig,
  type ServerConfigStreamEvent,
  WsSubscribeServerConfigRpc,
  WS_METHODS,
} from "@supaterm/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import type * as Rpc from "effect/rpc/Rpc";
import * as RpcClient from "effect/rpc/RpcClient";
import * as RpcClientError from "effect/rpc/RpcClientError";
import * as RpcSerialization from "effect/rpc/RpcSerialization";
import * as Socket from "effect/socket/Socket";

import { makeWsRpcProtocolClient, PING_TIMEOUT, type WsRpcProtocolClient } from "./protocol.ts";
import { UNRESPONSIVE_HOST_HINT } from "../errors/network.ts";
import type {
  ConnectionAttemptError,
  ConnectionTransientError,
  PreparedConnection,
} from "../connection/model.ts";
import {
  ConnectionBlockedError,
  ConnectionTransientError as ConnectionTransientErrorClass,
} from "../connection/model.ts";
import {
  applyServerConfigProjection,
  type ServerConfigProjection,
  withoutEnvironmentThemes,
} from "../state/serverConfigProjection.ts";
import { environmentMismatchError } from "../connection/errors.ts";

const SOCKET_OPEN_TIMEOUT = "15 seconds";

export interface RpcSession {
  readonly client: WsRpcProtocolClient;
  readonly initialConfig: Effect.Effect<ServerConfig, ConnectionAttemptError>;
  readonly configChanges: Stream.Stream<ServerConfig>;
  readonly subscribeServerConfig: (
    input: ServerConfigSubscriptionInput,
  ) => ServerConfigSubscription;
  readonly ready: Effect.Effect<void, ConnectionAttemptError>;
  readonly probe: Effect.Effect<void, ConnectionAttemptError>;
  readonly closed: Effect.Effect<never, ConnectionAttemptError>;
}

export interface RpcSessionOptions {
  readonly environmentThemes?: boolean;
}

export class RpcSessionFactory extends Context.Service<
  RpcSessionFactory,
  {
    readonly connect: (
      connection: PreparedConnection,
    ) => Effect.Effect<RpcSession, ConnectionAttemptError, Scope.Scope>;
  }
>()("@supaterm/client-runtime/rpc/session/RpcSessionFactory") {}

type InitialConfigError = Effect.Error<
  ReturnType<WsRpcProtocolClient[typeof WS_METHODS.serverGetConfig]>
>;
type ProbeError = Effect.Error<ReturnType<WsRpcProtocolClient[typeof WS_METHODS.serverProbe]>>;
type ServerConfigSubscriptionError =
  | Rpc.ErrorExit<typeof WsSubscribeServerConfigRpc>
  | RpcClientError.RpcClientError;
type ServerConfigSubscription = Stream.Stream<
  ServerConfigStreamEvent,
  ServerConfigSubscriptionError
>;
type ServerConfigSubscriptionInput = Parameters<
  WsRpcProtocolClient[typeof WS_METHODS.subscribeServerConfig]
>[0];

type EnvironmentThemesUpdatedEvent = Extract<
  ServerConfigStreamEvent,
  { readonly type: "environmentThemesUpdated" }
>;

interface ServerConfigReplayState {
  readonly projection: ServerConfigProjection;
  readonly revision: number;
  readonly themesEvent: EnvironmentThemesUpdatedEvent | undefined;
}

interface BufferedServerConfigEvent {
  readonly event: ServerConfigStreamEvent;
  readonly replay: ServerConfigReplayState;
  readonly revision: number;
}

function serverConfigReplayEvents(
  state: ServerConfigReplayState,
): ReadonlyArray<ServerConfigStreamEvent> {
  const snapshot = {
    version: 1 as const,
    type: "snapshot" as const,
    config: withoutEnvironmentThemes(state.projection.config),
  };
  return [snapshot, ...(state.themesEvent === undefined ? [] : [state.themesEvent])];
}

const PING_TIMEOUT_SECONDS = Duration.toSeconds(PING_TIMEOUT);

function mapSessionRpcError(
  error: InitialConfigError | ProbeError | ServerConfigSubscriptionError,
  via: "relay" | "direct",
): ConnectionAttemptError {
  switch (error._tag) {
    case "EnvironmentAuthorizationError":
      return new ConnectionBlockedError({
        reason: "permission",
        detail: error.message,
        hop: "server",
        via,
      });
    case "KeybindingsConfigParseError":
    case "ServerSettingsError":
      return new ConnectionTransientErrorClass({
        reason: "remote-unavailable",
        detail: error.message,
        hop: "server",
        via,
      });
    case "RpcClientError":
      return new ConnectionTransientErrorClass({
        reason: "transport",
        detail: error.message,
        ...socketFailureLocation(via),
      });
  }
}

function socketFailureLocation(via: "relay" | "direct") {
  return { hop: via === "relay" ? "tunnel" : "server", via } as const;
}

/** @public */
export const make = Effect.fn("RpcSessionFactory.make")(function* (
  options: RpcSessionOptions = {},
) {
  const webSocketConstructor = yield* Socket.WebSocketConstructor;
  const serverConfigInput: ServerConfigSubscriptionInput =
    options.environmentThemes === true ? { environmentThemes: true } : {};

  const connect = Effect.fnUntraced(function* (connection: PreparedConnection) {
    const via = connection.connectionMethod === "relay" ? "relay" : "direct";
    const mapRpcError = (error: Parameters<typeof mapSessionRpcError>[0]) =>
      mapSessionRpcError(error, via);
    yield* Effect.annotateCurrentSpan({
      "connection.environment.id": connection.environmentId,
    });

    const connected = yield* Deferred.make<void>();
    const disconnected = yield* Deferred.make<never, ConnectionTransientError>();
    const pingTimedOut = yield* Ref.make(false);
    const hooks = RpcClient.ConnectionHooks.of({
      onConnect: Deferred.succeed(connected, undefined).pipe(Effect.asVoid),
      onDisconnect: Effect.all([Deferred.isDone(connected), Ref.get(pingTimedOut)]).pipe(
        Effect.flatMap(([wasConnected, timedOut]) =>
          Deferred.fail(
            disconnected,
            new ConnectionTransientErrorClass({
              reason: "transport",
              detail: !wasConnected
                ? `${connection.label} could not establish a WebSocket connection.`
                : timedOut
                  ? `${connection.label} stopped responding for ${PING_TIMEOUT_SECONDS}s. ${UNRESPONSIVE_HOST_HINT}`
                  : `${connection.label} disconnected.`,
              ...socketFailureLocation(via),
            }),
          ),
        ),
        Effect.asVoid,
      ),
    });
    const layerSocket = Socket.layerWebSocket(connection.socketUrl, {
      openTimeout: SOCKET_OPEN_TIMEOUT,
    }).pipe(Layer.provide(Layer.succeed(Socket.WebSocketConstructor, webSocketConstructor)));
    const layerProtocol = Layer.effect(
      RpcClient.Protocol,
      RpcClient.makeProtocolSocket({
        pingTimeout: PING_TIMEOUT,
        retryTransientErrors: false,
        retryPolicy: Schedule.recurs(0),
        onPingTimeout: Ref.set(pingTimedOut, true),
      }),
    ).pipe(
      Layer.provide(
        Layer.mergeAll(
          layerSocket,
          RpcSerialization.layerJson,
          Layer.succeed(RpcClient.ConnectionHooks, hooks),
        ),
      ),
    );
    const protocolContext = yield* Layer.build(layerProtocol).pipe(
      Effect.withSpan("environment.websocket.connect"),
    );
    yield* Deferred.await(connected).pipe(
      Effect.raceFirst(Deferred.await(disconnected)),
      Effect.withSpan("environment.websocket.open"),
      Effect.ignore,
      Effect.forkScoped,
    );
    const protocolClient = yield* makeWsRpcProtocolClient.pipe(Effect.provide(protocolContext));
    const initialConfigDeferred = yield* Deferred.make<ServerConfig>();
    const serverConfigExit = yield* Deferred.make<void, ServerConfigSubscriptionError>();
    const configSubscriptionClosed = yield* Deferred.make<never, ConnectionAttemptError>();
    const serverConfigState = yield* Ref.make(Option.none<ServerConfigReplayState>());
    const serverConfigUpdates = yield* PubSub.sliding<BufferedServerConfigEvent>(64);
    const configSubscriptionEndedError = new ConnectionTransientErrorClass({
      reason: "remote-unavailable",
      detail: `${connection.label} config subscription ended.`,
    });
    const serverConfigSource = protocolClient[WS_METHODS.subscribeServerConfig](
      serverConfigInput,
    ).pipe(
      Stream.runForEach((event) =>
        Effect.gen(function* () {
          const buffered = yield* Ref.modify(serverConfigState, (current) => {
            const projection = applyServerConfigProjection(
              Option.map(current, (state) => state.projection),
              event,
            );
            if (Option.isNone(projection)) {
              return [Option.none<BufferedServerConfigEvent>(), current] as const;
            }
            const next = {
              projection: projection.value,
              revision: Option.match(current, {
                onNone: () => 1,
                onSome: (state) => state.revision + 1,
              }),
              themesEvent:
                event.type === "environmentThemesUpdated"
                  ? event
                  : Option.getOrUndefined(current)?.themesEvent,
            } satisfies ServerConfigReplayState;
            return [
              Option.some({ event, replay: next, revision: next.revision }),
              Option.some(next),
            ] as const;
          });
          if (Option.isSome(buffered)) {
            yield* PubSub.publish(serverConfigUpdates, buffered.value);
          }
          if (event.type === "snapshot") {
            yield* Deferred.succeed(initialConfigDeferred, event.config);
          }
        }),
      ),
      Effect.onExit((exit) => {
        if (Exit.isSuccess(exit)) {
          return Effect.all([
            Deferred.succeed(serverConfigExit, undefined),
            Deferred.fail(configSubscriptionClosed, configSubscriptionEndedError),
          ]).pipe(Effect.asVoid);
        }
        if (Cause.hasInterruptsOnly(exit.cause)) {
          return Effect.void;
        }
        return Effect.all([
          Deferred.failCause(serverConfigExit, exit.cause),
          Deferred.failCause(configSubscriptionClosed, Cause.map(exit.cause, mapRpcError)),
        ]).pipe(Effect.asVoid);
      }),
    );
    yield* serverConfigSource.pipe(Effect.forkScoped);
    const initialConfig = Effect.raceFirst(
      Deferred.await(initialConfigDeferred),
      Deferred.await(serverConfigExit).pipe(
        Effect.mapError(mapRpcError),
        Effect.flatMap(() => Effect.fail(configSubscriptionEndedError)),
      ),
    ).pipe(
      Effect.filterOrElse(
        (config) => config.environment.environmentId === connection.environmentId,
        (config) =>
          environmentMismatchError({
            expected: connection.environmentId,
            actual: config.environment.environmentId,
          }),
      ),
      Effect.withSpan("environment.initialSync"),
    );
    const serverConfigReplay = Stream.unwrap(
      Effect.gen(function* () {
        const subscription = yield* PubSub.subscribe(serverConfigUpdates);
        const snapshot = yield* Ref.get(serverConfigState);
        if (Option.isNone(snapshot)) {
          return Stream.empty;
        }
        const updates = Stream.fromSubscription(subscription).pipe(
          Stream.filter((buffered) => buffered.revision > snapshot.value.revision),
        );
        const terminal = Stream.fromEffect(Deferred.await(serverConfigExit)).pipe(Stream.drain);
        return Stream.concat(
          Stream.succeed({
            event: {
              version: 1,
              type: "snapshot",
              config: withoutEnvironmentThemes(snapshot.value.projection.config),
            },
            replay: snapshot.value,
            revision: snapshot.value.revision,
          } satisfies BufferedServerConfigEvent),
          Stream.merge(updates, terminal, { haltStrategy: "either" }),
        );
      }),
    );
    const serverConfigEvents = serverConfigReplay.pipe(
      Stream.mapAccum(
        (): number | undefined => undefined,
        (revision, buffered) => [
          buffered.revision,
          revision !== undefined && buffered.revision === revision + 1
            ? [buffered.event]
            : serverConfigReplayEvents(buffered.replay),
        ],
      ),
      Stream.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Stream.failCause(cause);
        }
        // The supervisor keeps the original cause. Shared durable consumers
        // need a transport-shaped failure so they wait for its replacement.
        return Stream.fail(
          new RpcClientError.RpcClientError({
            reason: new RpcClientError.RpcClientDefect({
              message: `${connection.label} config subscription failed.`,
              cause,
            }),
          }),
        );
      }),
    );
    const validatedInitialConfig = initialConfig.pipe(
      Effect.mapError(
        (cause) =>
          new RpcClientError.RpcClientError({
            reason: new RpcClientError.RpcClientDefect({
              message: `${connection.label} config subscription failed.`,
              cause,
            }),
          }),
      ),
    );
    const subscribeServerConfig = (input: ServerConfigSubscriptionInput) =>
      Stream.unwrap(
        validatedInitialConfig.pipe(
          Effect.as(
            Equal.equals(input, serverConfigInput)
              ? serverConfigEvents
              : protocolClient[WS_METHODS.subscribeServerConfig](input),
          ),
        ),
      );
    const configChanges = Stream.unwrap(initialConfig.pipe(Effect.as(serverConfigReplay))).pipe(
      Stream.map((buffered) => buffered.replay.projection.config),
      Stream.filter((config) => config.environment.environmentId === connection.environmentId),
      Stream.catch(() => Stream.empty),
    );
    const probe = initialConfig.pipe(
      Effect.flatMap(() =>
        protocolClient[WS_METHODS.serverProbe]({}).pipe(Effect.mapError(mapRpcError)),
      ),
      Effect.asVoid,
      Effect.withSpan("clientRuntime.connection.rpcSession.probe"),
    );

    return {
      client: protocolClient,
      initialConfig,
      configChanges,
      subscribeServerConfig,
      ready: Deferred.await(connected).pipe(
        Effect.andThen(initialConfig),
        Effect.asVoid,
        Effect.raceFirst(Deferred.await(disconnected)),
      ),
      probe,
      closed: Effect.raceFirst(
        Deferred.await(disconnected),
        Deferred.await(configSubscriptionClosed),
      ),
    } satisfies RpcSession;
  });

  return RpcSessionFactory.of({ connect });
});

export const layer = (options: RpcSessionOptions) => Layer.effect(RpcSessionFactory, make(options));
