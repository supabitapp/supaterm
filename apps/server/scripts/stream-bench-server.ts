// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalTimers:off - Bench child: Playwright and socket observers run outside the Effect runtime.
import * as NodeHttp from "node:http";
import * as NodeModule from "node:module";
import type * as NodeNet from "node:net";
import * as NodePath from "node:path";
import * as NodePerfHooks from "node:perf_hooks";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";
import type { Browser, BrowserContext, CDPSession } from "playwright-core";

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
const gc = (globalThis as { gc?: () => void }).gc;
if (!gc) throw new Error("run with --expose-gc");

const STOP_MS = 5_000;
process.once("disconnect", () => {
  process.kill(process.pid, "SIGTERM");
  setTimeout(() => process.exit(1), STOP_MS).unref();
});

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
  EnvironmentAuth,
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
  load<typeof import("../src/auth/EnvironmentAuth.ts")>("./src/auth/EnvironmentAuth.ts"),
  load<typeof import("../src/device/DeviceService.ts")>("./src/device/DeviceService.ts"),
  load<typeof import("../src/device/DeviceHubProxy.ts")>("./src/device/DeviceHubProxy.ts"),
]);

const now = () => NodePerfHooks.performance.timeOrigin + NodePerfHooks.performance.now();

const browsers = new Set<Browser>();
const cdp = { frames: 0, reducedFrames: 0, unacked: 0, unackedSince: 0, unackedMs: 0 };
const observeSession = (session: CDPSession) => {
  let maxWidth = 0;
  let fullWidth = 0;
  session.on("Page.screencastFrame", () => {
    cdp.frames++;
    if (maxWidth < fullWidth) cdp.reducedFrames++;
    if (cdp.unacked++ === 0) cdp.unackedSince = now();
  });
  const send = session.send;
  session.send = function (this: CDPSession, ...args: Parameters<CDPSession["send"]>) {
    if (args[0] === "Page.screencastFrameAck" && --cdp.unacked === 0)
      cdp.unackedMs += now() - cdp.unackedSince;
    if (args[0] === "Page.startScreencast") {
      maxWidth = (args[1] as { maxWidth: number }).maxWidth;
      fullWidth = Math.max(fullWidth, maxWidth);
    }
    return send.apply(this, args);
  } as CDPSession["send"];
};
const observeContext = <Context extends BrowserContext>(context: Context) => {
  const browser = context.browser();
  if (browser) {
    browsers.add(browser);
    browser.once("disconnected", () => browsers.delete(browser));
  }
  const newCDPSession = context.newCDPSession.bind(context);
  context.newCDPSession = async (page) => {
    const session = await newCDPSession(page);
    observeSession(session);
    return session;
  };
  return context;
};
const chromiumCpuMs = async () => {
  let total = 0;
  for (const browser of browsers) {
    const session = await browser.newBrowserCDPSession();
    const { processInfo } = await session.send("SystemInfo.getProcessInfo");
    await session.detach();
    for (const { cpuTime } of processInfo) total += cpuTime * 1000;
  }
  return total;
};

const deviceSockets = new Set<NodeNet.Socket>();
const deviceBuffered = () => {
  let bytes = 0;
  for (const socket of deviceSockets) bytes += socket.writableLength;
  return bytes;
};
let deviceBufferedMax = 0;
setInterval(() => {
  deviceBufferedMax = Math.max(deviceBufferedMax, deviceBuffered());
}, 250).unref();

// One gc() leaves freed ArrayBuffer backing stores counted in `external` until later turns.
const liveBytes = async () => {
  let previous = Number.NaN;
  for (let round = 0; round < 10; round++) {
    gc();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const { heapUsed, external } = process.memoryUsage();
    const bytes = heapUsed + external;
    if (Math.abs(bytes - previous) < 256 * 1024) return bytes;
    previous = bytes;
  }
  return previous;
};

type Request =
  | { readonly id: number; readonly type: "open"; readonly url: string }
  | { readonly id: number; readonly type: "mark" }
  | { readonly id: number; readonly type: "collect" };

let mark = { at: 0, cpu: process.cpuUsage(), rss: 0, live: 0, chromiumCpuMs: 0 };
const handle = async (request: Request, open: (url: string) => Promise<object>) => {
  switch (request.type) {
    case "open":
      return open(request.url);
    case "mark": {
      const live = await liveBytes();
      const chromium = await chromiumCpuMs();
      mark = {
        at: now(),
        cpu: process.cpuUsage(),
        rss: process.memoryUsage.rss(),
        live,
        chromiumCpuMs: chromium,
      };
      Object.assign(cdp, { frames: 0, reducedFrames: 0, unackedSince: now(), unackedMs: 0 });
      deviceBufferedMax = deviceBuffered();
      return {};
    }
    case "collect": {
      const at = now();
      const cpu = process.cpuUsage(mark.cpu);
      const unackedMs = cdp.unackedMs + (cdp.unacked > 0 ? at - cdp.unackedSince : 0);
      const chromium = hubOrigin
        ? null
        : {
            cpuMs: (await chromiumCpuMs()) - mark.chromiumCpuMs,
            frames: cdp.frames,
            reducedFrames: cdp.reducedFrames,
            unackedMs,
          };
      const deviceBufferedEnd = deviceBuffered();
      const rssEnd = process.memoryUsage.rss();
      return {
        elapsedMs: at - mark.at,
        cpuMs: (cpu.user + cpu.system) / 1000,
        rssStart: mark.rss,
        rssEnd,
        retainedGrowth: (await liveBytes()) - mark.live,
        deviceBufferedMax: Math.max(deviceBufferedMax, deviceBufferedEnd),
        deviceBufferedEnd,
        chromium,
      };
    }
  }
};

const serveRequests = Effect.fn("StreamBench.serveRequests")(function* (
  ready: object,
  open: (url: string) => Promise<object>,
) {
  const send = (message: object) => process.send?.(message);
  process.on("message", (request: Request) => {
    handle(request, open).then(
      (result) => send({ id: request.id, result }),
      (error: unknown) => send({ id: request.id, error: String(error) }),
    );
  });
  const address = httpServer.address() as NodeNet.AddressInfo;
  send({ id: 0, result: { port: address.port, ...ready } });
  return yield* Effect.never;
});

const environmentId = Contracts.EnvironmentId.make("stream-bench");
const threadId = Contracts.ThreadId.make("stream-bench-thread");

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

const httpServer = NodeHttp.createServer();
httpServer.on("upgrade", (request: NodeHttp.IncomingMessage, socket: NodeNet.Socket) => {
  if (!(request.url ?? "").startsWith(DeviceService.DEVICE_HUB_ROUTE_PREFIX)) return;
  deviceSockets.add(socket);
  socket.once("close", () => deviceSockets.delete(socket));
});
const listen = NodeHttpServer.layer(() => httpServer, { port: 0, host: "127.0.0.1" });

const device = (origin: string) =>
  serveRequests({}, () => Promise.reject(new Error("device mode cannot open"))).pipe(
    Effect.provide(
      HttpRouter.serve(DeviceHubProxy.layer, { disableListenLog: true }).pipe(
        Layer.provideMerge(listen),
        Layer.provide(auth),
        Layer.provide(
          Layer.succeed(DeviceService.DeviceService, {
            currentReadiness: () =>
              Effect.succeed({
                hostId: Contracts.LOCAL_DEVICE_HOST_ID,
                hub: { origin },
              } as DeviceReadiness),
          } as DeviceServiceTag["Service"]),
        ),
        Layer.provide(FetchHttpClient.layer),
      ),
    ),
  );

const preview = async () => {
  const [
    ServerConfig,
    ServerEnvironment,
    Broker,
    Manager,
    PreviewAgentActivity,
    DesktopBrowserChannel,
    PreviewBrowser,
    ServerBrowser,
    ServerBrowserStream,
  ] = await Promise.all([
    load<typeof import("../src/config.ts")>("./src/config.ts"),
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
  ]);
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
          PreviewBrowser.makePreviewBrowser({ baseDir: cacheDir, wait: "5 minutes" }),
        ),
        DesktopBrowserChannel.layer,
        PreviewAgentActivity.layer,
      ),
    ),
    Layer.provideMerge(ServerConfig.layerTest(checkout, { prefix: "supaterm-stream-bench-" })),
    Layer.provideMerge(FetchHttpClient.layer),
    Layer.provideMerge(NodeServices.layer),
  );
  const app = HttpRouter.serve(Layer.mergeAll(ServerBrowserStream.routeLayer, echo), {
    disableListenLog: true,
  }).pipe(Layer.provideMerge(listen), Layer.provide(auth), Layer.provideMerge(browser));
  return Effect.gen(function* () {
    const broker = yield* Broker.PreviewAutomationBroker;
    const executable = yield* (yield* PreviewBrowser.PreviewBrowser).executable;
    const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
    const open = async (url: string) => {
      const status = await runPromise(
        broker.invoke<{ readonly tabId?: string | null }>({
          scope: {
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
          },
          operation: "open",
          input: { url, reuseExistingTab: false, open: false },
        }),
      );
      if (!status.tabId) throw new Error("open returned no tab");
      return { threadId, tabId: status.tabId };
    };
    return yield* serveRequests({ executable }, open);
  }).pipe(Effect.provide(app));
};

NodeRuntime.runMain(hubOrigin ? device(hubOrigin) : await preview());
