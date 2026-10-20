import {
  EnvironmentId,
  ORCHESTRATION_PROTOCOL_VERSION,
  ExecutionEnvironmentDescriptor,
  WS_METHODS,
} from "@supaterm/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Socket from "effect/socket/Socket";

import { BearerConnectionProfile, type ConnectionCatalogEntry } from "./catalog.ts";
import { orchestrationProtocolCompatibilityError } from "./compatibility.ts";
import {
  BearerConnectionTarget,
  ConnectionTransientError,
  PrimaryConnectionTarget,
} from "./model.ts";
import { updateOutdatedHost } from "./outdatedHostUpdate.ts";
import * as EnvironmentRegistry from "./registry.ts";
import * as ConnectionResolver from "./resolver.ts";

const TARGET = new PrimaryConnectionTarget({
  environmentId: EnvironmentId.make("environment-old"),
  label: "Build Mac",
  httpBaseUrl: "https://build.example.test",
  wsBaseUrl: "wss://build.example.test",
});

const descriptor = (protocol: number, serverVersion: string) =>
  ({
    environmentId: TARGET.environmentId,
    label: TARGET.label,
    platform: { os: "darwin", arch: "arm64" },
    serverVersion,
    orchestrationProtocolVersion: protocol,
    capabilities: { serverSelfUpdate: "boot-service" },
  }) satisfies ExecutionEnvironmentDescriptor;

const RpcRequest = Schema.TaggedStruct("Request", {
  id: Schema.Union([Schema.String, Schema.Number]),
  payload: Schema.Unknown,
  tag: Schema.String,
});
const isRpcRequest = Schema.is(RpcRequest);
const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const encodeJson = Schema.encodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const encodeDescriptor = Schema.encodeSync(Schema.fromJsonString(ExecutionEnvironmentDescriptor));

type Listener = (event: { readonly type: string; readonly data?: unknown }) => void;

class OutdatedHostSocket {
  static readonly OPEN = 1;
  readyState = 0;
  readonly requests: Array<typeof RpcRequest.Type> = [];
  private readonly listeners = new Map<string, Set<Listener>>();

  readonly url: string;
  private readonly onUpdate: () => void;

  constructor(url: string, onUpdate: () => void) {
    this.url = url;
    this.onUpdate = onUpdate;
    queueMicrotask(() => {
      this.readyState = OutdatedHostSocket.OPEN;
      this.emit({ type: "open" });
    });
  }

  addEventListener(type: string, listener: Listener) {
    const listeners = this.listeners.get(type) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: Listener) {
    this.listeners.get(type)?.delete(listener);
  }

  send(data: string) {
    const message = decodeJson(data);
    if (!isRpcRequest(message)) return;
    this.requests.push(message);
    if (message.tag !== WS_METHODS.serverUpdateServer) return;
    this.onUpdate();
    queueMicrotask(() =>
      this.emit({
        type: "message",
        data: encodeJson({
          _tag: "Exit",
          requestId: message.id,
          exit: {
            _tag: "Success",
            value: { targetVersion: "0.0.46", method: "boot-service", updateId: "update-1" },
          },
        }),
      }),
    );
  }

  close() {
    this.readyState = 3;
    this.emit({ type: "close" });
  }

  private emit(event: { readonly type: string; readonly data?: unknown }) {
    for (const listener of this.listeners.get(event.type) ?? []) listener(event);
  }
}

describe("updateOutdatedHost", () => {
  it.effect.each([false, true])(
    "updates a protocol-1 host and resumes it (fallback route: %s)",
    (useFallback) =>
      Effect.gen(function* () {
        const blocked = orchestrationProtocolCompatibilityError(descriptor(1, "0.0.45"));
        expect(blocked).toMatchObject({ serverUpdateRequired: true });

        const sockets: Array<OutdatedHostSocket> = [];
        let served: ExecutionEnvironmentDescriptor = descriptor(1, "0.0.45");
        const entries = yield* SubscriptionRef.make<
          ReadonlyMap<EnvironmentId, ConnectionCatalogEntry>
        >(
          new Map([
            [
              TARGET.environmentId,
              {
                target: TARGET,
                profile: Option.none(),
                enabled: false,
                unsupportedReason: blocked?.message ?? "",
                serverUpdateRequired: true,
              },
            ],
          ]),
        );
        const fallbackUrl = "https://fallback.example.ts.net";
        const fallbackTarget = new BearerConnectionTarget({
          environmentId: TARGET.environmentId,
          label: TARGET.label,
          connectionId: "paired-fallback",
        });
        if (useFallback) {
          yield* SubscriptionRef.update(
            entries,
            (current) =>
              new Map([
                [
                  TARGET.environmentId,
                  {
                    ...current.get(TARGET.environmentId)!,
                    alternateRoutes: [
                      {
                        target: fallbackTarget,
                        profile: Option.some(
                          new BearerConnectionProfile({
                            environmentId: fallbackTarget.environmentId,
                            connectionId: fallbackTarget.connectionId,
                            label: fallbackTarget.label,
                            httpBaseUrl: fallbackUrl,
                            wsBaseUrl: fallbackUrl.replace(/^http/, "ws"),
                          }),
                        ),
                      },
                    ],
                  },
                ],
              ]),
          );
        }
        const preparedOrigins: Array<string> = [];
        const polledOrigins: Array<string> = [];
        const calls: Array<string> = [];
        const registry = EnvironmentRegistry.EnvironmentRegistry.of({
          entries,
          setCompatibility: (_environmentId: EnvironmentId, error: unknown) =>
            Effect.sync(() => calls.push(`compatibility:${error === null ? "clear" : "block"}`)),
          setEnabled: (_environmentId: EnvironmentId, enabled: boolean) =>
            Effect.sync(() => calls.push(`enabled:${enabled}`)),
        } as unknown as EnvironmentRegistry.EnvironmentRegistry["Service"]);
        const resolver = ConnectionResolver.ConnectionResolver.of({
          prepare: () => Effect.die(new Error("The update must bypass the protocol gate.")),
          prepareForUpdate: (entry) =>
            Effect.gen(function* () {
              const origin =
                entry.target._tag === "BearerConnectionTarget" ? fallbackUrl : TARGET.httpBaseUrl;
              preparedOrigins.push(origin);
              if (useFallback && entry.target._tag === "PrimaryConnectionTarget") {
                return yield* new ConnectionTransientError({
                  reason: "endpoint-unavailable",
                  detail: "LAN unavailable",
                });
              }
              return {
                descriptor: served,
                prepared: {
                  environmentId: TARGET.environmentId,
                  label: TARGET.label,
                  httpBaseUrl: origin,
                  socketUrl: `${origin.replace(/^http/, "ws")}/ws?wsTicket=ticket`,
                  httpAuthorization: null,
                  target: entry.target,
                },
              };
            }),
        });
        const httpClient = HttpClient.make((request) =>
          Effect.sync(() => {
            const origin = new URL(request.url).origin;
            polledOrigins.push(origin);
            // After restart this address belongs to a different server. A successful
            // descriptor response must not stop the search for our environment.
            const response =
              origin === fallbackUrl
                ? { ...served, environmentId: EnvironmentId.make("unrelated-environment") }
                : served;
            return HttpClientResponse.fromWeb(request, new Response(encodeDescriptor(response)));
          }),
        );

        const result = yield* updateOutdatedHost(
          TARGET.environmentId,
          { targetVersion: "0.0.46" },
          () => Effect.void,
        ).pipe(
          Effect.provide(
            Layer.mergeAll(
              Layer.succeed(EnvironmentRegistry.EnvironmentRegistry, registry),
              Layer.succeed(ConnectionResolver.ConnectionResolver, resolver),
              Layer.succeed(HttpClient.HttpClient, httpClient),
              Layer.succeed(Socket.WebSocketConstructor, (url) => {
                const socket = new OutdatedHostSocket(url, () => {
                  served = descriptor(ORCHESTRATION_PROTOCOL_VERSION, "0.0.46");
                });
                sockets.push(socket);
                return socket as unknown as globalThis.WebSocket;
              }),
            ),
          ),
        );

        expect(sockets[0]?.url).not.toContain("orchestrationProtocol");
        expect(sockets[0]?.requests.map((request) => request.tag)).toEqual([
          WS_METHODS.serverUpdateServer,
        ]);
        expect(preparedOrigins).toEqual(
          useFallback ? [TARGET.httpBaseUrl, fallbackUrl] : [TARGET.httpBaseUrl],
        );
        expect(polledOrigins).toEqual(
          useFallback ? [fallbackUrl, TARGET.httpBaseUrl] : [TARGET.httpBaseUrl],
        );
        expect(result.targetVersion).toBe("0.0.46");
        expect(calls).toEqual(["compatibility:clear", "enabled:true"]);
      }),
  );

  it.effect("switches a host that is already compatible back on without opening a socket", () =>
    Effect.gen(function* () {
      const calls: Array<string> = [];
      let opened = false;
      const prepared = {
        environmentId: TARGET.environmentId,
        label: TARGET.label,
        httpBaseUrl: TARGET.httpBaseUrl,
        socketUrl: "wss://build.example.test/ws",
        httpAuthorization: null,
        target: TARGET,
      };
      const result = yield* updateOutdatedHost(
        TARGET.environmentId,
        { targetVersion: "0.0.46" },
        () => Effect.void,
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.succeed(
              EnvironmentRegistry.EnvironmentRegistry,
              EnvironmentRegistry.EnvironmentRegistry.of({
                entries: yield* SubscriptionRef.make<
                  ReadonlyMap<EnvironmentId, ConnectionCatalogEntry>
                >(
                  new Map([
                    [
                      TARGET.environmentId,
                      { target: TARGET, profile: Option.none(), enabled: false },
                    ],
                  ]),
                ),
                setCompatibility: (_environmentId: EnvironmentId, error: unknown) =>
                  Effect.sync(() =>
                    calls.push(`compatibility:${error === null ? "clear" : "block"}`),
                  ),
                setEnabled: (_environmentId: EnvironmentId, enabled: boolean) =>
                  Effect.sync(() => calls.push(`enabled:${enabled}`)),
              } as unknown as EnvironmentRegistry.EnvironmentRegistry["Service"]),
            ),
            Layer.succeed(
              ConnectionResolver.ConnectionResolver,
              ConnectionResolver.ConnectionResolver.of({
                prepare: () => Effect.die(new Error("unused")),
                prepareForUpdate: () =>
                  Effect.succeed({
                    descriptor: descriptor(ORCHESTRATION_PROTOCOL_VERSION, "0.0.46"),
                    prepared,
                  }),
              }),
            ),
            Layer.succeed(
              HttpClient.HttpClient,
              HttpClient.make(() => Effect.die(new Error("unused"))),
            ),

            Layer.succeed(Socket.WebSocketConstructor, () => {
              opened = true;
              throw new Error("unused");
            }),
          ),
        ),
      );
      expect(opened).toBe(false);
      expect(result.targetVersion).toBe("0.0.46");
      expect(calls).toEqual(["compatibility:clear", "enabled:true"]);
    }),
  );

  it.effect("refuses a host that cannot update itself without opening a socket", () =>
    Effect.gen(function* () {
      const manual = {
        ...descriptor(1, "0.0.45"),
        capabilities: {},
      };
      let opened = false;
      const error = yield* Effect.flip(
        updateOutdatedHost(TARGET.environmentId, { targetVersion: "0.0.46" }, () => Effect.void),
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.succeed(
              EnvironmentRegistry.EnvironmentRegistry,
              EnvironmentRegistry.EnvironmentRegistry.of({
                entries: yield* SubscriptionRef.make<
                  ReadonlyMap<EnvironmentId, ConnectionCatalogEntry>
                >(
                  new Map([
                    [
                      TARGET.environmentId,
                      { target: TARGET, profile: Option.none(), enabled: false },
                    ],
                  ]),
                ),
              } as unknown as EnvironmentRegistry.EnvironmentRegistry["Service"]),
            ),
            Layer.succeed(
              ConnectionResolver.ConnectionResolver,
              ConnectionResolver.ConnectionResolver.of({
                prepare: () => Effect.die(new Error("unused")),
                prepareForUpdate: () =>
                  Effect.succeed({
                    descriptor: manual,
                    prepared: {
                      environmentId: TARGET.environmentId,
                      label: TARGET.label,
                      httpBaseUrl: TARGET.httpBaseUrl,
                      socketUrl: "wss://build.example.test/ws",
                      httpAuthorization: null,
                      target: TARGET,
                    },
                  }),
              }),
            ),
            Layer.succeed(
              HttpClient.HttpClient,
              HttpClient.make(() => Effect.die(new Error("unused"))),
            ),
            Layer.succeed(Socket.WebSocketConstructor, () => {
              opened = true;
              throw new Error("unused");
            }),
          ),
        ),
      );
      expect(error).toMatchObject({ _tag: "OutdatedHostUpdateError" });
      expect(opened).toBe(false);
    }),
  );
});
