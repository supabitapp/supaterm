// @effect-diagnostics nodeBuiltinImport:off - serves the proxy on a real HTTP server with production WebSocket options.
import { expect, it } from "@effect/vitest";
import { NodeWS } from "@effect/platform-node/NodeSocket";
import * as NodeHttp from "node:http";
import * as NodeNet from "node:net";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as TestClock from "effect/testing/TestClock";
import { HttpRouter, HttpServer } from "effect/http";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Socket from "effect/socket/Socket";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import {
  AuthOrchestrationOperateScope,
  AuthSessionId,
  LOCAL_DEVICE_HOST_ID,
} from "@supaterm/contracts";
import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as DeviceService from "./DeviceService.ts";
import * as DeviceHubProxy from "./DeviceHubProxy.ts";

const listenHub = Effect.fn("DeviceHubProxyTest.listenHub")(function* (
  onConnection: (socket: NodeWS.WebSocket) => void,
) {
  const hub = yield* Effect.acquireRelease(
    Effect.sync(() => new NodeWS.WebSocketServer({ port: 0 })),
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
  hub.on("connection", onConnection);
  return address.port;
});

const serveProxy = Effect.fn("DeviceHubProxyTest.serveProxy")(function* (hubPort: number) {
  const services = yield* Layer.build(
    HttpRouter.serve(DeviceHubProxy.layer, { disableListenLog: true }).pipe(
      // Production's WebSocket options, so viewers can offer permessage-deflate.
      Layer.provideMerge(
        NodeHttpServer.layer(NodeHttp.createServer, {
          port: 0,
          websocket: { perMessageDeflate: true },
        }),
      ),
      Layer.provide(FetchHttpClient.layer),
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
    ),
  );
  return HttpServer.formatAddress(Context.get(services, HttpServer.HttpServer).address).replace(
    /^http/,
    "ws",
  );
});

it.effect("preserves binary input and admission frames through the real socket proxy", () =>
  Effect.gen(function* () {
    const hubPort = yield* listenHub((socket) => {
      socket.send(Uint8Array.of(0x83));
      socket.on("message", (data, binary) => socket.send(data, { binary }));
    });
    const origin = yield* serveProxy(hubPort);
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

// Each viewer tick makes the hub emit one frame, skipped the way serve-emu does once its socket to
// the proxy holds more than 512 KiB. 1024 incompressible frames overfill every buffer in between.
const stallViewer = Effect.fn("DeviceHubProxyTest.stallViewer")(function* () {
  const frame = crypto.getRandomValues(new Uint8Array(64 * 1024));
  const hub = { sent: 0, skipped: 0, closed: Promise.withResolvers<void>() };
  const handled = yield* Queue.unbounded<void>();
  const hubPort = yield* listenHub((socket) => {
    socket.once("close", () => hub.closed.resolve());
    socket.on("message", () => {
      if (socket.bufferedAmount > 512 * 1024) hub.skipped += 1;
      else {
        socket.send(frame);
        hub.sent += 1;
      }
      Queue.offerUnsafe(handled, undefined);
    });
  });
  const origin = yield* serveProxy(hubPort);
  const viewer = yield* Effect.acquireRelease(
    Effect.promise(() => {
      const socket = new NodeWS.WebSocket(
        `${origin}/api/device-hub/vendor/serve-emu/ws?wsTicket=test`,
        { perMessageDeflate: true },
      );
      return new Promise<NodeWS.WebSocket>((resolve, reject) => {
        socket.once("open", () => resolve(socket));
        socket.once("error", reject);
      });
    }),
    (socket) => Effect.sync(() => socket.terminate()),
  );
  viewer.pause();
  for (let tick = 0; tick < 1024; tick += 1) {
    viewer.send(Uint8Array.of(0));
    yield* Queue.take(handled);
  }
  return { hub, viewer };
});

it.effect(
  "holds the hub back while a viewer stops reading video, then delivers every sent frame",
  () =>
    Effect.gen(function* () {
      const { hub, viewer } = yield* stallViewer();
      expect(hub.skipped).toBeGreaterThan(0);
      expect(viewer.extensions).toBe("");
      let received = 0;
      const delivered = Promise.withResolvers<void>();
      viewer.on("message", () => {
        received += 1;
        if (received === hub.sent) delivered.resolve();
      });
      viewer.resume();
      yield* Effect.promise(() => delivered.promise);
    }),
);

it.effect("closes a viewer that stays stalled and releases its hub connection", () =>
  Effect.gen(function* () {
    const { hub, viewer } = yield* stallViewer();
    yield* TestClock.adjust("10 seconds");
    yield* Effect.promise(() => hub.closed.promise);
    const closed = new Promise<number>((resolve) => viewer.once("close", (code) => resolve(code)));
    viewer.resume();
    expect(yield* Effect.promise(() => closed)).toBe(1013);
  }),
);

it.live("closes an upstream socket that is still connecting without an unhandled error", () =>
  Effect.gen(function* () {
    const dialed = Promise.withResolvers<NodeNet.Socket>();
    // Accepts the connection and never answers the WebSocket handshake. It reads what arrives,
    // since a paused socket never emits `close` for the client's FIN.
    const hub = yield* Effect.acquireRelease(
      Effect.promise(
        () =>
          new Promise<NodeNet.Server>((resolve) => {
            const server = NodeNet.createServer((socket) => dialed.resolve(socket.resume()));
            server.listen(0, "127.0.0.1", () => resolve(server));
          }),
      ),
      (server) =>
        Effect.promise(() => new Promise<void>((resolve) => server.close(() => resolve()))),
    );
    const address = hub.address();
    if (typeof address !== "object" || !address) throw new Error("Missing hub port");
    const upstream = yield* Socket.makeWebSocket(`ws://127.0.0.1:${address.port}`).pipe(
      Effect.provide(DeviceHubProxy.upstreamWebSocketConstructor),
    );
    const reading = yield* Effect.forkChild(
      Effect.scoped(Effect.flatMap(upstream.reader, ({ pull }) => pull)),
    );
    const connection = yield* Effect.promise(() => dialed.promise);
    const abandoned = new Promise<void>((resolve) => connection.once("close", () => resolve()));
    yield* Fiber.interrupt(reading);
    yield* Effect.promise(() => abandoned);
  }),
);
