// @effect-diagnostics nodeBuiltinImport:off - dials real direct tunnels on the host's HTTP port.
import * as NodeCrypto from "node:crypto";
import * as NodeHttp from "node:http";
import * as NodeNet from "node:net";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  createTunnelConnector,
  TUNNEL_MAX_PLAIN_BYTES,
  type TunnelVia,
} from "@supaterm/shared/relay/tunnel";
import { openLoopbackRelay, TunnelSocket } from "@supaterm/shared/relay/tunnelNode";
import { expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { HttpRouter, HttpServer, HttpServerRequest, HttpServerResponse } from "effect/http";
import WebSocket from "ws";
import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as SessionStore from "../auth/SessionStore.ts";
import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as DirectTunnel from "./DirectTunnel.ts";
import * as DirectTunnelHttp from "./DirectTunnelHttp.ts";
import * as RelayIdentity from "./RelayIdentity.ts";
import * as RelayIngress from "./RelayIngress.ts";

const layerConfig = (overrides: Partial<ServerConfig.ServerConfig["Service"]> = {}) =>
  Layer.effect(
    ServerConfig.ServerConfig,
    Effect.gen(function* () {
      return { ...(yield* ServerConfig.ServerConfig), ...overrides };
    }),
  ).pipe(
    Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "supaterm-direct-tunnel-" })),
  );

const layerRoutes = Layer.mergeAll(
  DirectTunnelHttp.layer,
  HttpRouter.add("GET", "/", Effect.succeed(HttpServerResponse.text("root"))),
  HttpRouter.add(
    "GET",
    "/.well-known/supaterm/environment",
    Effect.succeed(
      HttpServerResponse.jsonUnsafe(
        { environmentId: "direct-tunnel" },
        { headers: { "set-cookie": "session=leaked; Path=/" } },
      ),
    ),
  ),
  HttpRouter.add(
    "GET",
    "/api/test/peer",
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      return HttpServerResponse.jsonUnsafe({
        connectionMethod: RelayIngress.tunnelConnectionMethod(request) ?? null,
        remoteAddress: Option.getOrNull(request.remoteAddress),
      });
    }),
  ),
  HttpRouter.add(
    "GET",
    "/api/test/session",
    Effect.gen(function* () {
      const auth = yield* EnvironmentAuth.EnvironmentAuth;
      return yield* auth.authenticateHttpRequest(yield* HttpServerRequest.HttpServerRequest).pipe(
        Effect.as(HttpServerResponse.empty({ status: 200 })),
        Effect.orElseSucceed(() => HttpServerResponse.empty({ status: 401 })),
      );
    }),
  ),
  HttpRouter.add(
    "GET",
    "/api/test/shared-socket",
    Effect.gen(function* () {
      const socket = yield* (yield* HttpServerRequest.HttpServerRequest).upgrade;
      yield* socket.reader;
      return HttpServerResponse.empty();
    }),
  ),
);

const startHost = (limits: DirectTunnel.DirectTunnelLimits) =>
  Effect.gen(function* () {
    const server = NodeHttp.createServer();
    const context = yield* Layer.build(
      HttpRouter.serve(layerRoutes.pipe(Layer.provide(RelayIngress.layerPathGuard)), {
        disableListenLog: true,
        disableLogger: true,
      }).pipe(
        Layer.provideMerge(DirectTunnel.layerWithLimits(limits)),
        Layer.provideMerge(
          EnvironmentAuth.layer.pipe(
            Layer.provideMerge(SqlitePersistence.layerMemory),
            Layer.provide(ServerEnvironment.layerIdentity),
          ),
        ),
        Layer.provideMerge(RelayIdentity.layer),
        Layer.provideMerge(ServerSecretStore.layer),
        Layer.provideMerge(layerConfig()),
        Layer.provideMerge(RelayIngress.layerFromServer(server)),
        Layer.provideMerge(
          NodeHttpServer.layer(() => server, {
            host: "127.0.0.1",
            port: 0,
            gracefulShutdownTimeout: 0,
            websocket: { perMessageDeflate: true },
          }),
        ),
      ),
    );
    const address = Context.get(context, HttpServer.HttpServer).address;
    if (!("port" in address)) throw new Error("No TCP listener");
    return {
      port: address.port,
      url: `ws://127.0.0.1:${address.port}`,
      identity: Context.get(context, RelayIdentity.RelayIdentity),
      auth: Context.get(context, EnvironmentAuth.EnvironmentAuth),
      cookieName: Context.get(context, SessionStore.SessionStore).cookieName,
    };
  });

const roomy = { pendingHandshakes: 16, sessions: 64, sessionsPerPeer: 8 };

const openTunnel = (relayUrl: string, address: string) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const sockets: Array<WebSocket> = [];
      const connector = createTunnelConnector(address, {
        relayUrl,
        randomBytes: NodeCrypto.randomBytes,
        createSocket: (url) => {
          const socket = new WebSocket(url);
          sockets.push(socket);
          return socket;
        },
      });
      return { connector, sockets };
    }),
    ({ connector }) => Effect.sync(() => connector.close()),
  );

type Tunnel = Effect.Success<ReturnType<typeof openTunnel>>;

type Reply = {
  readonly status: number;
  readonly headers: NodeHttp.IncomingHttpHeaders;
  readonly body: string;
};

const readResponse = (response: NodeHttp.IncomingMessage) =>
  new Promise<Reply>((resolve) => {
    let body = "";
    response.setEncoding("utf8");
    response.on("data", (chunk: string) => {
      body += chunk;
    });
    response.on("end", () =>
      resolve({ status: response.statusCode!, headers: response.headers, body }),
    );
  });

const send = (options: NodeHttp.RequestOptions): Promise<Reply> =>
  new Promise((resolve, reject) => {
    const request = NodeHttp.request(options, (response) => resolve(readResponse(response)));
    request.on("upgrade", (response, socket) => {
      socket.destroy();
      resolve({ status: response.statusCode!, headers: response.headers, body: "" });
    });
    request.on("error", reject);
    request.end();
  });

const tunneled = (tunnel: Tunnel, path: string, headers: NodeHttp.OutgoingHttpHeaders = {}) =>
  Effect.promise(async () => {
    const socket = new TunnelSocket(await tunnel.connector.open());
    try {
      return await send({
        createConnection: () => socket,
        path,
        headers: { host: "host.test", ...headers },
      });
    } finally {
      socket.destroy();
    }
  });

const direct = (port: number, path: string, headers: NodeHttp.OutgoingHttpHeaders = {}) =>
  Effect.promise(() => send({ host: "127.0.0.1", port, path, headers }));

const upgradeHeaders = {
  connection: "Upgrade",
  upgrade: "websocket",
  "sec-websocket-key": NodeCrypto.randomBytes(16).toString("base64"),
  "sec-websocket-version": "13",
};

type Dialed =
  | { readonly status: number }
  | {
      readonly status: 101;
      readonly socket: WebSocket;
      readonly extensions: string | undefined;
      readonly closed: Promise<void>;
    };

const dial = (url: string) =>
  Effect.promise(
    () =>
      new Promise<Dialed>((resolve, reject) => {
        const socket = new WebSocket(url, { perMessageDeflate: true });
        let extensions: string | undefined;
        socket.once("upgrade", (response) => {
          extensions = response.headers["sec-websocket-extensions"];
        });
        socket.once("unexpected-response", (request, response) => {
          response.resume();
          request.destroy();
          resolve({ status: response.statusCode! });
        });
        socket.once("open", () =>
          resolve({
            status: 101,
            socket,
            extensions,
            closed: new Promise((closed) => socket.once("close", () => closed())),
          }),
        );
        socket.once("error", reject);
      }),
  );

// Sends only a frame header, so a host without the payload cap would wait for
// the body instead of answering with a close frame.
const declareFrame = (port: number, path: string, length: number) =>
  Effect.promise(
    () =>
      new Promise<number>((resolve, reject) => {
        const socket = NodeNet.connect(port, "127.0.0.1");
        let received = Buffer.alloc(0);
        let upgraded = false;
        socket.on("error", reject);
        socket.on("connect", () =>
          socket.write(
            [
              `GET ${path} HTTP/1.1`,
              "Host: 127.0.0.1",
              "Connection: Upgrade",
              "Upgrade: websocket",
              "Sec-WebSocket-Version: 13",
              `Sec-WebSocket-Key: ${NodeCrypto.randomBytes(16).toString("base64")}`,
              "",
              "",
            ].join("\r\n"),
          ),
        );
        socket.on("data", (chunk) => {
          received = Buffer.concat([received, chunk]);
          if (!upgraded) {
            const end = received.indexOf("\r\n\r\n");
            if (end < 0) return;
            upgraded = true;
            received = received.subarray(end + 4);
            const header = Buffer.alloc(14);
            header[0] = 0x82;
            header[1] = 0x80 | 127;
            header.writeBigUInt64BE(BigInt(length), 2);
            socket.write(header);
          }
          if (received.length >= 4 && received[0] === 0x88) {
            resolve(received.readUInt16BE(2));
            socket.destroy();
          }
        });
      }),
  );

const opened = (dialed: Dialed) => {
  if (!("socket" in dialed)) throw new Error(`Expected an upgrade, got ${dialed.status}`);
  return dialed;
};

const closedPortUrl = Effect.promise(
  () =>
    new Promise<string>((resolve, reject) => {
      const server = NodeNet.createServer();
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (address === null || typeof address === "string") {
          reject(new Error("No TCP listener"));
          return;
        }
        server.close(() => resolve(`ws://127.0.0.1:${address.port}`));
      });
    }),
);

const connectUrl = (host: { readonly url: string }, endpointId: string) =>
  `${host.url}/v1/connect?endpointId=${endpointId}`;

it.layer(NodeServices.layer)("DirectTunnel", (it) => {
  it.effect("carries API requests to the host without cookies in either direction", () =>
    Effect.gen(function* () {
      const host = yield* startHost(roomy);
      const identity = yield* host.identity.get;
      const tunnel = yield* openTunnel(host.url, identity.address);

      const environment = yield* tunneled(tunnel, "/.well-known/supaterm/environment");
      expect(environment.status).toBe(200);
      expect(JSON.parse(environment.body)).toEqual({ environmentId: "direct-tunnel" });
      expect(environment.headers["set-cookie"]).toBeUndefined();
      expect(tunnel.sockets[0]?.extensions).toBe("");

      expect(JSON.parse((yield* tunneled(tunnel, "/api/test/peer")).body)).toEqual({
        connectionMethod: "direct-tunnel",
        remoteAddress: "127.0.0.1",
      });
      expect(JSON.parse((yield* direct(host.port, "/api/test/peer")).body)).toEqual({
        connectionMethod: null,
        remoteAddress: "127.0.0.1",
      });

      expect((yield* direct(host.port, "/")).status).toBe(200);
      expect((yield* tunneled(tunnel, "/")).status).toBe(404);
      const nested = `/v1/connect?endpointId=${identity.endpointId}`;
      expect((yield* tunneled(tunnel, nested, upgradeHeaders)).status).toBe(404);
      expect(tunnel.sockets).toHaveLength(1);
    }).pipe(Effect.scoped),
  );

  it.effect("reaches the host directly through a client's race when the relay is down", () =>
    Effect.gen(function* () {
      const host = yield* startHost(roomy);
      const identity = yield* host.identity.get;
      const deadRelay = yield* closedPortUrl;
      const reports: Array<TunnelVia | undefined> = [];
      const relay = yield* Effect.acquireRelease(
        Effect.promise(() =>
          openLoopbackRelay(identity.address, {
            relayUrl: deadRelay,
            directUrls: () => [host.url],
            randomBytes: NodeCrypto.randomBytes,
            createSocket: (url) => new WebSocket(url),
            onVia: (via) => reports.push(via),
          }),
        ),
        (opened) => Effect.promise(opened.close),
      );
      const origin = new URL(relay.origin);

      const peer = yield* Effect.promise(() =>
        send({ host: origin.hostname, port: Number(origin.port), path: "/api/test/peer" }),
      );
      expect(JSON.parse(peer.body)).toEqual({
        connectionMethod: "direct-tunnel",
        remoteAddress: "127.0.0.1",
      });
      expect(reports).toEqual(["direct"]);
    }).pipe(Effect.scoped),
  );

  it.effect("authenticates tunneled requests by bearer token, never by cookie", () =>
    Effect.gen(function* () {
      const host = yield* startHost(roomy);
      const identity = yield* host.identity.get;
      const pairing = yield* host.auth.issuePairingCredential({ scopes: ["orchestration:read"] });
      const session = yield* host.auth.createBrowserSession(pairing.credential, {
        deviceType: "desktop",
      });
      const cookie = `${session.cookieName ?? host.cookieName}=${session.sessionToken}`;
      const tunnel = yield* openTunnel(host.url, identity.address);

      expect((yield* direct(host.port, "/api/test/session", { cookie })).status).toBe(200);
      expect((yield* tunneled(tunnel, "/api/test/session", { cookie })).status).toBe(401);
      expect(
        (yield* tunneled(tunnel, "/api/test/session", {
          authorization: `Bearer ${session.sessionToken}`,
        })).status,
      ).toBe(200);
    }).pipe(Effect.scoped),
  );

  it.effect("answers 404 unless the request names this host's identity", () =>
    Effect.gen(function* () {
      const host = yield* startHost(roomy);
      const endpointId = "ab".repeat(32);
      expect((yield* dial(connectUrl(host, endpointId))).status).toBe(404);
      expect(Option.isNone(yield* host.identity.existing)).toBe(true);

      const identity = yield* host.identity.get;
      expect((yield* dial(connectUrl(host, endpointId))).status).toBe(404);
      expect((yield* dial(`${host.url}/v1/connect`)).status).toBe(404);
      expect(
        (yield* direct(host.port, `/v1/connect?endpointId=${identity.endpointId}`)).status,
      ).toBe(404);
    }).pipe(Effect.scoped),
  );

  it.effect("keeps permessage-deflate off the tunnel but on the shared socket server", () =>
    Effect.gen(function* () {
      const host = yield* startHost(roomy);
      const identity = yield* host.identity.get;
      const tunnel = opened(yield* dial(connectUrl(host, identity.endpointId)));
      expect(tunnel.extensions).toBeUndefined();
      const shared = opened(yield* dial(`${host.url}/api/test/shared-socket`));
      expect(shared.extensions).toContain("permessage-deflate");
      tunnel.socket.close();
      yield* Effect.promise(() => Promise.all([tunnel.closed, shared.closed]));
    }).pipe(Effect.scoped),
  );

  it.effect("closes a tunnel whose first message is not a small text hello", () =>
    Effect.gen(function* () {
      const host = yield* startHost(roomy);
      const identity = yield* host.identity.get;
      const url = connectUrl(host, identity.endpointId);

      const oversized = opened(yield* dial(url));
      oversized.socket.send("x".repeat(4097));
      yield* Effect.promise(() => oversized.closed);

      const binary = opened(yield* dial(url));
      binary.socket.send(new Uint8Array(32));
      yield* Effect.promise(() => binary.closed);
    }).pipe(Effect.scoped),
  );

  it.effect("refuses a frame larger than one tunnel record from its header alone", () =>
    Effect.gen(function* () {
      const host = yield* startHost(roomy);
      const identity = yield* host.identity.get;
      const path = `/v1/connect?endpointId=${identity.endpointId}`;
      expect(yield* declareFrame(host.port, path, TUNNEL_MAX_PLAIN_BYTES + 25)).toBe(1009);
    }).pipe(Effect.scoped),
  );

  it.effect("closes a handshake that misses its deadline and frees its slot", () =>
    Effect.gen(function* () {
      const host = yield* startHost({ ...roomy, pendingHandshakes: 1 });
      const identity = yield* host.identity.get;
      const url = connectUrl(host, identity.endpointId);

      const stalled = opened(yield* dial(url));
      expect((yield* dial(url)).status).toBe(503);
      yield* TestClock.adjust("15 seconds");
      yield* Effect.promise(() => stalled.closed);

      const tunnel = yield* openTunnel(host.url, identity.address);
      expect((yield* tunneled(tunnel, "/api/test/peer")).status).toBe(200);
    }).pipe(Effect.scoped),
  );

  it.effect("limits direct sessions per peer", () =>
    Effect.gen(function* () {
      const host = yield* startHost({ ...roomy, sessionsPerPeer: 2 });
      const identity = yield* host.identity.get;
      const first = yield* openTunnel(host.url, identity.address);
      const second = yield* openTunnel(host.url, identity.address);
      expect((yield* tunneled(first, "/api/test/peer")).status).toBe(200);
      expect((yield* tunneled(second, "/api/test/peer")).status).toBe(200);
      expect((yield* dial(connectUrl(host, identity.endpointId))).status).toBe(503);
    }).pipe(Effect.scoped),
  );

  it.effect("limits direct sessions across peers", () =>
    Effect.gen(function* () {
      const host = yield* startHost({ ...roomy, sessions: 1 });
      const identity = yield* host.identity.get;
      const tunnel = yield* openTunnel(host.url, identity.address);
      expect((yield* tunneled(tunnel, "/api/test/peer")).status).toBe(200);
      expect((yield* dial(connectUrl(host, identity.endpointId))).status).toBe(503);
    }).pipe(Effect.scoped),
  );
});

const layerAdvertiser = (host: string) =>
  DirectTunnel.layerWithLimits(roomy).pipe(
    Layer.provideMerge(RelayIdentity.layer),
    Layer.provide(ServerSecretStore.layer),
    Layer.provide(Layer.succeed(RelayIngress.RelayIngress, { accept: () => {} })),
    Layer.provide(layerConfig({ host, port: 3773 })),
  );

it.layer(NodeServices.layer)("DirectTunnel advertisement", (it) => {
  it.effect("advertises a non-loopback bind once the identity exists", () =>
    Effect.gen(function* () {
      const tunnel = yield* DirectTunnel.DirectTunnel;
      const identity = yield* RelayIdentity.RelayIdentity;
      expect(Option.isNone(yield* tunnel.advertisement)).toBe(true);
      const updates = yield* tunnel.advertisements.pipe(
        Stream.tap((current) => (Option.isNone(current) ? identity.get : Effect.void)),
        Stream.take(2),
        Stream.runCollect,
      );
      const created = yield* identity.get;
      const expected = { address: created.address, urls: ["ws://192.168.1.20:3773"] };
      expect(Array.from(updates)).toEqual([Option.none(), Option.some(expected)]);
      expect(yield* tunnel.advertisement).toEqual(Option.some(expected));
    }).pipe(Effect.provide(layerAdvertiser("192.168.1.20"))),
  );

  it.effect("never advertises a loopback bind", () =>
    Effect.gen(function* () {
      const tunnel = yield* DirectTunnel.DirectTunnel;
      yield* (yield* RelayIdentity.RelayIdentity).get;
      expect(Option.isNone(yield* tunnel.advertisement)).toBe(true);
    }).pipe(Effect.provide(layerAdvertiser("127.0.0.1"))),
  );
});
