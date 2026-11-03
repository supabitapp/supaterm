// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalTimers:off - Bench child: Playwright and socket observers run outside the Effect runtime.
/**
 * The server half of scripts/stream-bench. It serves the real preview stream and device hub
 * proxy routes from the checkout named by --checkout, so the same harness can measure another
 * branch, and reports what it observes to the parent over IPC.
 */
import * as NodeHttp from "node:http";
import * as NodeModule from "node:module";
import * as NodeNet from "node:net";
import * as NodePath from "node:path";
import * as NodePerfHooks from "node:perf_hooks";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";
import type { CDPSession, BrowserContext } from "playwright-core";

import type {
  DeviceReadiness,
  DeviceService as DeviceServiceTag,
} from "../src/device/DeviceService.ts";

const { values } = NodeUtil.parseArgs({
  options: {
    checkout: { type: "string", default: NodePath.resolve(import.meta.dirname, "../../..") },
    "cache-dir": { type: "string" },
    "hub-origin": { type: "string" },
  },
});
const checkout = NodePath.resolve(values.checkout);
const cacheDir = values["cache-dir"];
if (!cacheDir) throw new Error("--cache-dir is required");
const hubOrigin = values["hub-origin"];

const serverRoot = NodePath.join(checkout, "apps/server");
const serverRequire = NodeModule.createRequire(NodePath.join(serverRoot, "package.json"));
const load = <Module>(specifier: string): Promise<Module> =>
  import(
    NodeURL.pathToFileURL(
      specifier.startsWith(".")
        ? NodePath.join(serverRoot, specifier)
        : serverRequire.resolve(specifier),
    ).href
  );

const [
  Effect,
  Layer,
  { FetchHttpClient, HttpRouter, HttpServerRequest, HttpServerResponse },
  NodeHttpServer,
  NodeRuntime,
  NodeServices,
  Contracts,
  ServerConfig,
  EnvironmentAuth,
  ServerEnvironment,
  Broker,
  Manager,
  PreviewAgentActivity,
  DesktopBrowserChannel,
  PreviewBrowser,
  ServerBrowser,
  ServerBrowserStream,
  DeviceService,
  DeviceHubProxy,
] = await Promise.all([
  load<typeof import("effect/Effect")>("effect/Effect"),
  load<typeof import("effect/Layer")>("effect/Layer"),
  load<typeof import("effect/http")>("effect/http"),
  load<typeof import("@effect/platform-node/NodeHttpServer")>(
    "@effect/platform-node/NodeHttpServer",
  ),
  load<typeof import("@effect/platform-node/NodeRuntime")>("@effect/platform-node/NodeRuntime"),
  load<typeof import("@effect/platform-node/NodeServices")>("@effect/platform-node/NodeServices"),
  // The workspace package exports only an `import` condition, which require.resolve cannot see.
  load<typeof import("@supaterm/contracts")>("../../packages/contracts/src/index.ts"),
  load<typeof import("../src/config.ts")>("./src/config.ts"),
  load<typeof import("../src/auth/EnvironmentAuth.ts")>("./src/auth/EnvironmentAuth.ts"),
  load<typeof import("../src/environment/ServerEnvironment.ts")>(
    "./src/environment/ServerEnvironment.ts",
  ),
  load<typeof import("../src/mcp/PreviewAutomationBroker.ts")>(
    "./src/mcp/PreviewAutomationBroker.ts",
  ),
  load<typeof import("../src/preview/Manager.ts")>("./src/preview/Manager.ts"),
  load<typeof import("../src/preview/PreviewAgentActivity.ts")>(
    "./src/preview/PreviewAgentActivity.ts",
  ),
  load<typeof import("../src/preview/DesktopBrowserChannel.ts")>(
    "./src/preview/DesktopBrowserChannel.ts",
  ),
  load<typeof import("../src/preview/PreviewBrowser.ts")>("./src/preview/PreviewBrowser.ts"),
  load<typeof import("../src/preview/ServerBrowser.ts")>("./src/preview/ServerBrowser.ts"),
  load<typeof import("../src/preview/ServerBrowserStream.ts")>(
    "./src/preview/ServerBrowserStream.ts",
  ),
  load<typeof import("../src/device/DeviceService.ts")>("./src/device/DeviceService.ts"),
  load<typeof import("../src/device/DeviceHubProxy.ts")>("./src/device/DeviceHubProxy.ts"),
]);

const now = () => NodePerfHooks.performance.timeOrigin + NodePerfHooks.performance.now();

const observed = {
  cdpFrames: [] as Array<[time: number, bytes: number, maxWidth: number]>,
  cdpInFlight: [] as Array<[time: number, frames: number]>,
  previewAckRtts: [] as Array<number>,
  samples: [] as Array<{
    readonly time: number;
    readonly cpuMs: number;
    readonly rss: number;
    readonly deviceBuffered: number;
  }>,
};
const resetObserved = () => {
  for (const list of Object.values(observed)) list.length = 0;
  loopDelay.reset();
};

// Chromium's frames and the acks ServerBrowser returns, seen on each screencast CDP session.
const observeSession = (session: CDPSession) => {
  let inFlight = 0;
  let maxWidth = 0;
  session.on("Page.screencastFrame", (frame) => {
    const time = now();
    observed.cdpFrames.push([time, Math.floor((frame.data.length * 3) / 4), maxWidth]);
    observed.cdpInFlight.push([time, ++inFlight]);
  });
  const send = session.send;
  session.send = function (this: CDPSession, ...args: Parameters<CDPSession["send"]>) {
    if (args[0] === "Page.screencastFrameAck") observed.cdpInFlight.push([now(), --inFlight]);
    if (args[0] === "Page.startScreencast") maxWidth = (args[1] as { maxWidth: number }).maxWidth;
    return send.apply(this, args);
  } as CDPSession["send"];
};
const observeContext = <Context extends BrowserContext>(context: Context) => {
  const newCDPSession = context.newCDPSession.bind(context);
  context.newCDPSession = async (page) => {
    const session = await newCDPSession(page);
    observeSession(session);
    return session;
  };
  return context;
};
const { chromium } = serverRequire("playwright-core") as typeof import("playwright-core");
const launchPersistentContext = chromium.launchPersistentContext.bind(chromium);
chromium.launchPersistentContext = async (...args) =>
  observeContext(await launchPersistentContext(...args));
const launch = chromium.launch.bind(chromium);
chromium.launch = async (...args) => {
  const browser = await launch(...args);
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (...contextArgs) => observeContext(await newContext(...contextArgs));
  return browser;
};

/** Calls back per WebSocket frame; payloads come unmasked for small frames only. */
const frameParser = (onFrame: (opcode: number, payload: Buffer | null) => void) => {
  let buffer: Buffer = Buffer.alloc(0);
  let skip = 0;
  return (chunk: Buffer) => {
    if (skip > 0) {
      const skipped = Math.min(skip, chunk.length);
      skip -= skipped;
      chunk = chunk.subarray(skipped);
    }
    buffer = buffer.length > 0 ? Buffer.concat([buffer, chunk]) : chunk;
    while (buffer.length >= 2) {
      const opcode = buffer[0]! & 0x0f;
      const masked = (buffer[1]! & 0x80) !== 0;
      let length = buffer[1]! & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (buffer.length < 4) return;
        length = buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (buffer.length < 10) return;
        length = Number(buffer.readBigUInt64BE(2));
        offset = 10;
      }
      const maskAt = offset;
      if (masked) offset += 4;
      if (buffer.length < offset) return;
      if (length > 256) {
        onFrame(opcode, null);
        const available = buffer.length - offset;
        if (available < length) {
          skip = length - available;
          buffer = Buffer.alloc(0);
          return;
        }
        buffer = buffer.subarray(offset + length);
        continue;
      }
      if (buffer.length < offset + length) return;
      const payload = Buffer.from(buffer.subarray(offset, offset + length));
      if (masked) for (let i = 0; i < length; i++) payload[i]! ^= buffer[maskAt + (i & 3)]!;
      onFrame(opcode, payload);
      buffer = buffer.subarray(offset + length);
    }
  };
};

const deviceSockets = new Set<NodeNet.Socket>();
const ACK = '{"type":"ack"}';
const observeUpgrade = (request: NodeHttp.IncomingMessage, socket: NodeNet.Socket) => {
  const path = request.url ?? "";
  if (path.startsWith(DeviceService.DEVICE_HUB_ROUTE_PREFIX)) {
    deviceSockets.add(socket);
    socket.once("close", () => deviceSockets.delete(socket));
    return;
  }
  if (!path.startsWith("/api/preview-stream/ws")) return;
  // The route keeps one frame on the wire, and the viewer acks every frame in order.
  const unacked: Array<number> = [];
  const outbound = frameParser((opcode) => {
    if (opcode === 2) unacked.push(now());
  });
  let handshake = true;
  const write = socket.write;
  socket.write = function (this: NodeNet.Socket, ...args: Parameters<NodeNet.Socket["write"]>) {
    const [chunk] = args;
    if (handshake) handshake = false;
    else if (typeof chunk === "string") outbound(Buffer.from(chunk));
    else outbound(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength));
    return write.apply(this, args);
  } as NodeNet.Socket["write"];
  socket.on(
    "data",
    frameParser((opcode, payload) => {
      if (opcode !== 1 || payload?.toString() !== ACK) return;
      const sentAt = unacked.shift();
      if (sentAt !== undefined) observed.previewAckRtts.push(now() - sentAt);
    }),
  );
};

// Live memory after a full GC, so garbage the run has not collected yet does not count.
const retained = () => {
  (globalThis as { gc?: () => void }).gc?.();
  const { heapUsed, external } = process.memoryUsage();
  return heapUsed + external;
};
let retainedAtMark = 0;

const loopDelay = NodePerfHooks.monitorEventLoopDelay({ resolution: 10 });
loopDelay.enable();
setInterval(() => {
  const cpu = process.cpuUsage();
  let deviceBuffered = 0;
  for (const socket of deviceSockets) deviceBuffered += socket.writableLength;
  observed.samples.push({
    time: now(),
    cpuMs: (cpu.user + cpu.system) / 1000,
    rss: process.memoryUsage.rss(),
    deviceBuffered,
  });
}, 250).unref();

const environmentId = Contracts.EnvironmentId.make("stream-bench");
const threadId = Contracts.ThreadId.make("stream-bench-thread");
const invocationScope = {
  environmentId,
  thread: {
    threadId,
    providerSessionId: "stream-bench",
    providerInstanceId: Contracts.ProviderInstanceId.make("codex"),
  },
  client: undefined,
  requestNamespace: "stream-bench",
  capabilities: new Set(["preview"] as const),
  issuedAt: Date.now(),
};

const auth = Layer.mock(EnvironmentAuth.EnvironmentAuth, {
  authenticateWebSocketUpgrade: () =>
    Effect.succeed({
      sessionId: Contracts.AuthSessionId.make("stream-bench"),
      subject: "stream-bench",
      method: "bearer-access-token" as const,
      scopes: [
        Contracts.AuthOrchestrationReadScope,
        Contracts.AuthOrchestrationOperateScope,
        Contracts.AuthPreviewOperateScope,
      ],
    }),
});
const devices = Layer.succeed(DeviceService.DeviceService, {
  currentReadiness: () =>
    Effect.succeed(
      hubOrigin === undefined
        ? null
        : ({
            hostId: Contracts.LOCAL_DEVICE_HOST_ID,
            hub: { origin: hubOrigin },
          } as DeviceReadiness),
    ),
} as DeviceServiceTag["Service"]);

const browser = ServerBrowser.layer.pipe(
  Layer.provideMerge(
    Layer.mergeAll(
      Broker.layer,
      Manager.layer,
      Layer.succeed(ServerEnvironment.ServerEnvironment, {
        getEnvironmentId: Effect.succeed(environmentId),
        getDescriptor: Effect.die("unused by the bench"),
      }),
      Layer.effect(
        PreviewBrowser.PreviewBrowser,
        PreviewBrowser.makePreviewBrowser({ baseDir: cacheDir, wait: "15 minutes" }),
      ),
      DesktopBrowserChannel.layer,
      PreviewAgentActivity.layer,
    ),
  ),
  Layer.provideMerge(ServerConfig.layerTest(checkout, { prefix: "supaterm-stream-bench-" })),
  Layer.provideMerge(FetchHttpClient.layer),
  Layer.provideMerge(NodeServices.layer),
);

const echo = HttpRouter.add(
  "GET",
  "/bench/echo",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const socket = yield* request.upgrade;
    yield* Effect.scoped(
      Effect.gen(function* () {
        const writer = yield* socket.writer;
        const { pull } = yield* socket.reader;
        while (true) yield* writer.writeAll(yield* pull);
      }),
    ).pipe(Effect.ignoreCause);
    return HttpServerResponse.empty();
  }),
);

const httpServer = NodeHttp.createServer();
httpServer.on("upgrade", observeUpgrade);
const app = HttpRouter.serve(
  Layer.mergeAll(ServerBrowserStream.routeLayer, DeviceHubProxy.layer, echo),
  { disableListenLog: true },
).pipe(
  Layer.provideMerge(NodeHttpServer.layer(() => httpServer, { port: 0, host: "127.0.0.1" })),
  Layer.provide(auth),
  Layer.provide(devices),
  Layer.provideMerge(browser),
);

type Request =
  | { readonly id: number; readonly type: "open"; readonly url: string }
  | { readonly id: number; readonly type: "mark" }
  | { readonly id: number; readonly type: "collect" };

const main = Effect.gen(function* () {
  const broker = yield* Broker.PreviewAutomationBroker;
  const executable = yield* (yield* PreviewBrowser.PreviewBrowser).executable;
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const send = (message: object) => process.send?.(message);
  const handle = async (request: Request) => {
    switch (request.type) {
      case "open": {
        const status = await runPromise(
          broker.invoke<{ readonly tabId?: string | null }>({
            scope: invocationScope,
            operation: "open",
            input: { url: request.url, reuseExistingTab: false, open: false },
          }),
        );
        return { threadId, tabId: status.tabId };
      }
      case "mark":
        resetObserved();
        retainedAtMark = retained();
        return {};
      case "collect":
        return {
          ...observed,
          retained: { start: retainedAtMark, end: retained() },
          loopDelayP99Ms: loopDelay.percentile(99) / 1e6,
        };
    }
  };
  process.on("message", (request: Request) => {
    handle(request).then(
      (result) => send({ id: request.id, result }),
      (error: unknown) => send({ id: request.id, error: String(error) }),
    );
  });
  const address = httpServer.address() as NodeNet.AddressInfo;
  send({ type: "ready", port: address.port, executable, pid: process.pid });
  return yield* Effect.never;
}).pipe(Effect.provide(app));

NodeRuntime.runMain(main);
