import {
  type ServerConfig,
  type ServerConfigStreamEvent,
  WsSubscribeServerConfigRpc,
  WS_METHODS,
} from "@supaterm/contracts";
import {
  joinSocketFrameParts,
  SOCKET_FRAME_PARTS_QUERY_PARAM,
} from "@supaterm/shared/socketFrameParts";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
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
import * as Schema from "effect/Schema";
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
import { recordServerClock } from "../clock.ts";

const SOCKET_OPEN_TIMEOUT = "15 seconds";

export interface RpcSession {
  readonly client: WsRpcProtocolClient;
  readonly initialConfig: Effect.Effect<ServerConfig, ConnectionAttemptError>;
  readonly configChanges: Stream.Stream<ServerConfig>;
  readonly subscribeServerConfig: (
    input: ServerConfigSubscriptionInput,
  ) => ServerConfigSubscription;
  /** Succeeds once the WebSocket has opened, before the first snapshot. */
  readonly opened: Effect.Effect<void, ConnectionAttemptError>;
  readonly ready: Effect.Effect<void, ConnectionAttemptError>;
  readonly probe: Effect.Effect<void, ConnectionAttemptError>;
  /** Frames received so far: proof the socket is alive that needs no reply. */
  readonly inboundFrames: Effect.Effect<number>;
  readonly closed: Effect.Effect<never, ConnectionAttemptError>;
}

export interface RpcSessionOptions {
  readonly environmentThemes?: boolean;
  readonly providerCatalogsOnDemand?: boolean;
  readonly providerCatalogDigests?: boolean;
  readonly providerStatusDeltas?: boolean;
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

const isSocketErrorReason = Schema.is(Socket.SocketErrorReason);
const PING_TIMEOUT_SECONDS = Duration.toSeconds(PING_TIMEOUT);

function mapSessionRpcError(
  error: InitialConfigError | ProbeError | ServerConfigSubscriptionError | ConnectionAttemptError,
  via: "relay" | "direct",
  socketFailure: () => ConnectionTransientError,
): ConnectionAttemptError {
  switch (error._tag) {
    case "ConnectionBlockedError":
    case "ConnectionTransientError":
      return error;
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
      return isSocketErrorReason(error.reason)
        ? socketFailure()
        : new ConnectionTransientErrorClass({
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
  const serverConfigInput: ServerConfigSubscriptionInput = {
    ...(options.environmentThemes === true ? { environmentThemes: true } : {}),
    ...(options.providerCatalogsOnDemand === true ? { providerCatalogsOnDemand: true } : {}),
    ...(options.providerCatalogDigests === true ? { providerCatalogDigests: true } : {}),
    ...(options.providerStatusDeltas === true ? { providerStatusDeltas: true } : {}),
  };
  // Config state merges the snapshots it fetches back in, so no subscriber needs them broadcast.
  const onDemandSnapshots = (input: ServerConfigSubscriptionInput) => ({
    ...input,
    workspaceSnapshotsOnDemand: true,
  });

  const connect = Effect.fnUntraced(function* (connection: PreparedConnection) {
    const via = connection.connectionMethod === "relay" ? "relay" : "direct";
    yield* Effect.annotateCurrentSpan({
      "connection.environment.id": connection.environmentId,
    });

    const connected = yield* Deferred.make<void>();
    const disconnected = yield* Deferred.make<never, ConnectionTransientError>();
    let pingTimedOut = false;
    const socketFailure = () =>
      new ConnectionTransientErrorClass({
        reason: "transport",
        detail: !Deferred.isDoneUnsafe(connected)
          ? `${connection.label} could not establish a WebSocket connection.`
          : pingTimedOut
            ? `${connection.label} stopped responding for ${PING_TIMEOUT_SECONDS}s. ${UNRESPONSIVE_HOST_HINT}`
            : `${connection.label} disconnected.`,
        ...socketFailureLocation(via),
      });
    const mapRpcError = (error: Parameters<typeof mapSessionRpcError>[0]) =>
      mapSessionRpcError(error, via, socketFailure);
    const hooks = RpcClient.ConnectionHooks.of({
      onConnect: Deferred.succeed(connected, undefined).pipe(Effect.asVoid),
      onDisconnect: Effect.suspend(() => Deferred.fail(disconnected, socketFailure())).pipe(
        Effect.asVoid,
      ),
    });
    // The protocol never reopens its socket, so every frame counted here came
    // from this session's one socket.
    let inboundFrames = 0;
    const countingWebSocketConstructor: typeof webSocketConstructor = (url, options) => {
      const socket = webSocketConstructor(url, options);
      socket.addEventListener("message", () => {
        inboundFrames += 1;
      });
      return socket;
    };
    const socketUrl = new URL(connection.socketUrl);
    socketUrl.searchParams.set(SOCKET_FRAME_PARTS_QUERY_PARAM, "1");
    const layerSocket = Layer.effect(
      Socket.Socket,
      Effect.map(Effect.service(Socket.Socket), joinSocketFrameParts),
    ).pipe(
      Layer.provide(
        Socket.layerWebSocket(socketUrl.toString(), {
          openTimeout: SOCKET_OPEN_TIMEOUT,
        }),
      ),
      Layer.provide(Layer.succeed(Socket.WebSocketConstructor, countingWebSocketConstructor)),
    );
    const layerProtocol = Layer.effect(
      RpcClient.Protocol,
      RpcClient.makeProtocolSocket({
        pingTimeout: PING_TIMEOUT,
        retryTransientErrors: false,
        retryPolicy: Schedule.recurs(0),
        // RpcClient runs this before it fails the open requests.
        onPingTimeout: Effect.sync(() => {
          pingTimedOut = true;
        }),
      }).pipe(
        // Teardown sends an interrupt per open stream, and a write to a closed
        // socket waits out the client's 1s interrupt timeout before reconnecting.
        // Requests still go through, so they fail with the protocol error.
        Effect.map((protocol) => ({
          ...protocol,
          send: (clientId, request, transferables) =>
            request._tag !== "Request" && Deferred.isDoneUnsafe(disconnected)
              ? Effect.void
              : protocol.send(clientId, request, transferables),
        })),
      ),
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
    const serverConfigExit = yield* Deferred.make<
      void,
      ServerConfigSubscriptionError | ConnectionAttemptError
    >();
    const configSubscriptionClosed = yield* Deferred.make<never, ConnectionAttemptError>();
    const serverConfigState = yield* Ref.make(Option.none<ServerConfigReplayState>());
    const serverConfigUpdates = yield* PubSub.sliding<BufferedServerConfigEvent>(64);
    const configSubscriptionEndedError = new ConnectionTransientErrorClass({
      reason: "remote-unavailable",
      detail: `${connection.label} config subscription ended.`,
    });
    // An interrupt while the session is not closing came from the server; it ends the subscription.
    let closingSession = false;
    const configRequestedAtMs = yield* Clock.currentTimeMillis;
    const serverConfigSource = protocolClient[WS_METHODS.subscribeServerConfig](
      onDemandSnapshots(serverConfigInput),
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
            // Later snapshots may repeat the first one's serverTime. Record
            // before readiness so the first timers already use its clock.
            if (!(yield* Deferred.isDone(initialConfigDeferred))) {
              const { serverTime } = event.config;
              recordServerClock(connection.environmentId, {
                serverTimeMs: serverTime === undefined ? undefined : Date.parse(serverTime),
                requestedAtMs: configRequestedAtMs,
                receivedAtMs: yield* Clock.currentTimeMillis,
              });
            }
            yield* Deferred.succeed(initialConfigDeferred, event.config);
          }
        }),
      ),
      // An unreadable first snapshot means the versions are incompatible. A later
      // unreadable update ends the session, and the reconnect's snapshot decides.
      Effect.catchDefect((defect) =>
        Schema.isSchemaError(defect)
          ? Effect.logWarning("Server configuration failed to decode.", {
              environmentId: connection.environmentId,
              issue: defect.message,
            }).pipe(
              Effect.andThen(
                Effect.fail(
                  Deferred.isDoneUnsafe(initialConfigDeferred)
                    ? new ConnectionTransientErrorClass({
                        reason: "remote-unavailable",
                        detail: `${connection.label} sent a server configuration update this client could not read.`,
                        hop: "server",
                        via,
                      })
                    : new ConnectionBlockedError({
                        reason: "unsupported",
                        detail: `${connection.label} sent an incompatible server configuration. Update the client and server to compatible versions.`,
                        hop: "server",
                        via,
                      }),
                ),
              ),
            )
          : Effect.die(defect),
      ),
      Effect.onExit((exit) => {
        if (Exit.isSuccess(exit) || (Cause.hasInterruptsOnly(exit.cause) && !closingSession)) {
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
    // Finalizers run in reverse, so this is set before the fork above is interrupted.
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        closingSession = true;
      }),
    );
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
          return Stream.failCause(
            Cause.fromReasons<never>(cause.reasons.filter(Cause.isInterruptReason)),
          );
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
              : protocolClient[WS_METHODS.subscribeServerConfig](onDemandSnapshots(input)),
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
        Effect.gen(function* () {
          const requestedAtMs = yield* Clock.currentTimeMillis;
          const result = yield* protocolClient[WS_METHODS.serverProbe]({}).pipe(
            Effect.mapError(mapRpcError),
          );
          if (result.serverTime !== undefined) {
            recordServerClock(connection.environmentId, {
              serverTimeMs: Date.parse(result.serverTime),
              requestedAtMs,
              receivedAtMs: yield* Clock.currentTimeMillis,
            });
          }
        }),
      ),
      Effect.withSpan("clientRuntime.connection.rpcSession.probe"),
    );

    const opened = Deferred.await(connected).pipe(Effect.raceFirst(Deferred.await(disconnected)));
    return {
      client: protocolClient,
      initialConfig,
      configChanges,
      subscribeServerConfig,
      opened,
      ready: initialConfig.pipe(Effect.asVoid),
      probe,
      inboundFrames: Effect.sync(() => inboundFrames),
      // The config stream also fails on disconnect, and only it can report a decode failure.
      closed: Deferred.await(configSubscriptionClosed),
    } satisfies RpcSession;
  });

  return RpcSessionFactory.of({ connect });
});

export const layer = (options: RpcSessionOptions) => Layer.effect(RpcSessionFactory, make(options));
