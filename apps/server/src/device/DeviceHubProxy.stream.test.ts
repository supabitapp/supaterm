import { expect, it } from "@effect/vitest";
import { NodeWS } from "@effect/platform-node/NodeSocket";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpRouter, HttpServer } from "effect/http";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import {
  AuthOrchestrationOperateScope,
  AuthSessionId,
  LOCAL_DEVICE_HOST_ID,
} from "@supaterm/contracts";
import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as DeviceService from "./DeviceService.ts";
import * as DeviceHubProxy from "./DeviceHubProxy.ts";
import * as DeviceStreamTuning from "./DeviceStreamTuning.ts";

const hubServer = Effect.gen(function* () {
  const hub = yield* Effect.acquireRelease(
    Effect.sync(() => new NodeWS.WebSocketServer({ host: "127.0.0.1", port: 0 })),
    (server) =>
      Effect.promise(
        () =>
          new Promise<void>((resolve) => {
            for (const client of server.clients) client.terminate();
            server.close(() => resolve());
          }),
      ),
  );
  if (!hub.address())
    yield* Effect.promise(() => new Promise<void>((resolve) => hub.once("listening", resolve)));
  const address = hub.address();
  if (typeof address !== "object" || !address) throw new Error("Missing hub port");
  return { hub, port: address.port };
});

const proxyOrigin = Effect.fn(function* (hubPort: number) {
  const services = yield* Layer.build(
    HttpRouter.serve(DeviceHubProxy.layer, { disableListenLog: true }).pipe(
      Layer.provideMerge(NodeHttpServer.layerTest),
      Layer.provide(
        Layer.succeed(EnvironmentAuth.EnvironmentAuth, {
          authenticateWebSocketUpgrade: () =>
            Effect.succeed({
              sessionId: AuthSessionId.make("test"),
              subject: "test",
              method: "bearer-access-token",
              scopes: [AuthOrchestrationOperateScope],
            }),
        } as unknown as EnvironmentAuth.EnvironmentAuth["Service"]),
      ),
      Layer.provide(
        Layer.succeed(DeviceService.DeviceService, {
          currentReadiness: () =>
            Effect.succeed({
              hostId: LOCAL_DEVICE_HOST_ID,
              hub: { origin: `http://127.0.0.1:${hubPort}` },
            }),
        } as DeviceService.DeviceService["Service"]),
      ),
      Layer.provide(
        Layer.succeed(DeviceStreamTuning.DeviceStreamTuning, { watch: () => Effect.void }),
      ),
    ),
  );
  return HttpServer.formatAddress(Context.get(services, HttpServer.HttpServer).address).replace(
    /^http/,
    "ws",
  );
});

it.effect("preserves binary input and admission frames through the real socket proxy", () =>
  Effect.gen(function* () {
    const { hub, port } = yield* hubServer;
    hub.on("connection", (socket) => {
      socket.send(Uint8Array.of(0x83));
      socket.on("message", (data, binary) => socket.send(data, { binary }));
    });
    const origin = yield* proxyOrigin(port);
    const client = yield* Effect.acquireRelease(
      Effect.sync(
        () =>
          new WebSocket(
            `${origin}/api/device-hub/vendor/serve-sim/helper/ws?device=test&wsTicket=test`,
          ),
      ),
      (socket) => Effect.sync(() => socket.close()),
    );
    client.binaryType = "arraybuffer";
    const frames: number[][] = [];
    const received = Promise.withResolvers<void>();
    client.addEventListener("error", () => received.reject(new Error("Proxy failed")));
    client.addEventListener("message", ({ data }) => {
      frames.push(Array.from(new Uint8Array(data as ArrayBuffer)));
      if (frames.length === 1) {
        client.send(Uint8Array.of(0x03, 1));
        client.send(Uint8Array.of(0x03, 2));
      } else if (frames.length === 3) received.resolve();
    });
    yield* Effect.promise(() => received.promise);
    expect(frames).toEqual([[0x83], [0x03, 1], [0x03, 2]]);
  }),
);

it.effect("lets a viewer that stops reading back up the hub's socket so the hub drops frames", () =>
  Effect.gen(function* () {
    const { hub, port } = yield* hubServer;
    const connected = Promise.withResolvers<NodeWS.WebSocket>();
    hub.once("connection", connected.resolve);
    const origin = yield* proxyOrigin(port);
    const viewer = yield* Effect.acquireRelease(
      Effect.sync(
        () => new NodeWS.WebSocket(`${origin}/api/device-hub/vendor/serve-emu/ws?device=test`),
      ),
      (socket) => Effect.sync(() => socket.terminate()),
    );
    yield* Effect.promise(
      () =>
        new Promise<void>((resolve, reject) => viewer.once("open", resolve).once("error", reject)),
    );
    viewer.pause();
    const upstream = yield* Effect.promise(() => connected.promise);

    const serveEmuDropBytes = 512 * 1024;
    const frameBytes = 256 * 1024;
    const attempts = 256;
    const sent: number[] = [];
    for (let index = 0; index < attempts; index++) {
      if (upstream.bufferedAmount <= serveEmuDropBytes) {
        upstream.send(Buffer.alloc(frameBytes, index % 256));
        sent.push(index % 256);
      }
      yield* Effect.promise(() => new Promise((resolve) => setImmediate(resolve)));
    }
    expect(attempts - sent.length).toBeGreaterThan(attempts / 2);

    const received: number[] = [];
    const delivered = Promise.withResolvers<void>();
    viewer.on("message", (data: Buffer) => {
      received.push(data.byteLength === frameBytes ? data[0]! : -1);
      if (received.length === sent.length) delivered.resolve();
    });
    viewer.resume();
    yield* Effect.promise(() => delivered.promise);
    expect(received).toEqual(sent);
  }),
);
