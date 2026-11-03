// @effect-diagnostics nodeBuiltinImport:off globalTimers:off - Serves the viewer pages and drives a headless viewer.
import * as NodeFS from "node:fs";
import * as NodeHttp from "node:http";
import type * as NodeNet from "node:net";
import * as NodePath from "node:path";

import * as esbuild from "esbuild";
import { chromium, type Browser } from "playwright-core";

import {
  linkMetrics,
  queueName,
  serverMetrics,
  sleep,
  startServer,
  startShaper,
  STOP_MS,
  within,
  type Link,
  type RunConfig,
} from "./runner.ts";
import { median, percentile, round, spread, type Aggregate } from "./stats.ts";

export const WORKLOADS = ["idle", "scroll", "anim"] as const;

export interface PreviewCell {
  readonly target: "preview";
  readonly workload: (typeof WORKLOADS)[number];
  readonly link: Link;
  readonly width: number;
  readonly height: number;
}
export const previewCellName = (cell: PreviewCell) =>
  `${cell.workload} ${cell.link.name} ${queueName(cell.link)} ${cell.width}x${cell.height}`;

// Covers a first Chromium install, which the server child abandons after 5 minutes.
const INSTALL_MS = 6 * 60_000;

export const setupPreview = async (cleanup: AsyncDisposableStack, checkout: string) => {
  const here = import.meta.dirname;
  const clientSource = NodePath.join(
    checkout,
    "packages/client-runtime/src/preview/serverBrowserStream.ts",
  );
  const built = await esbuild.build({
    stdin: {
      contents: `export { createPreviewStreamClient, createPreviewFramePainter } from ${JSON.stringify(clientSource)};`,
      resolveDir: NodePath.dirname(clientSource),
      loader: "ts",
    },
    bundle: true,
    format: "iife",
    globalName: "previewStream",
    platform: "browser",
    target: "es2022",
    write: false,
  });
  await esbuild.stop();
  const pages: Record<string, readonly [type: string, body: string]> = {
    "/client.js": ["text/javascript", built.outputFiles[0]!.text],
    "/viewer.js": [
      "text/javascript",
      NodeFS.readFileSync(NodePath.join(here, "viewer.js"), "utf8"),
    ],
    "/workload.html": [
      "text/html",
      NodeFS.readFileSync(NodePath.join(here, "workload.html"), "utf8"),
    ],
    "/viewer.html": [
      "text/html",
      '<!doctype html><body style="margin:0;background:#000"><canvas></canvas><script src="/client.js"></script><script src="/viewer.js"></script></body>',
    ],
  };
  const pageServer = NodeHttp.createServer((request, response) => {
    const page = pages[new URL(request.url ?? "/", "http://bench").pathname];
    if (!page) response.writeHead(404).end();
    else
      response
        .writeHead(200, { "content-type": page[0], "cache-control": "no-store" })
        .end(page[1]);
  });
  await new Promise<void>((resolve) => pageServer.listen(0, "127.0.0.1", resolve));
  cleanup.defer(() => {
    pageServer.closeAllConnections();
    pageServer.close();
  });
  let viewer: Promise<Browser> | undefined;
  return {
    pageOrigin: `http://127.0.0.1:${(pageServer.address() as NodeNet.AddressInfo).port}`,
    viewerBrowser: (executablePath: string) =>
      (viewer ??= chromium
        .launch({ executablePath, headless: true, handleSIGINT: false, handleSIGTERM: false })
        .then((browser) => {
          cleanup.defer(async () => {
            await within(browser.close(), STOP_MS);
          });
          return browser;
        })),
  };
};
type PreviewSetup = Awaited<ReturnType<typeof setupPreview>>;

interface ViewerRun {
  readonly durationMs: number;
  readonly receivedFrames: number;
  readonly receivedBytes: number;
  readonly paintLatencies: ReadonlyArray<number>;
  readonly staleFrames: number;
  readonly sourceFps: number | null;
  readonly echoes: ReadonlyArray<number>;
  readonly misreads: number;
}

export const runPreview = async (
  scope: AsyncDisposableStack,
  setup: PreviewSetup,
  cell: PreviewCell,
  config: RunConfig,
) => {
  const server = await startServer<{ readonly port: number; readonly executable: string }>(
    scope,
    config,
    [],
    INSTALL_MS,
  );
  const shaper = await startShaper(scope, cell.link, server.ready.port);
  const origin = `127.0.0.1:${shaper?.ready.port ?? server.ready.port}`;
  const { threadId, tabId } = await server.request("open", {
    url: `${setup.pageOrigin}/workload.html?kind=${cell.workload}`,
  });
  const browser = await setup.viewerBrowser(server.ready.executable);
  const page = await browser.newPage({
    viewport: { width: cell.width, height: cell.height },
    deviceScaleFactor: 2,
  });
  scope.defer(() => page.close().catch(() => undefined));
  const query = new URLSearchParams({
    ws: `ws://${origin}/api/preview-stream`,
    http: `http://${origin}/api/preview-stream`,
    echo: `ws://${origin}/bench/echo`,
    threadId,
    tabId,
    kind: cell.workload,
    width: String(cell.width),
    height: String(cell.height),
  });
  await page.goto(`${setup.pageOrigin}/viewer.html?${query}`);
  await page.waitForFunction("bench.isReady()", undefined, { timeout: 30_000 });
  await sleep(config.warmupMs);
  await Promise.all([server.request("mark"), shaper?.request("mark")]);
  await page.evaluate("bench.start()");
  await sleep(config.seconds * 1000);
  const viewer = await page.evaluate<ViewerRun>("bench.stop()");
  const [stats, link] = await Promise.all([server.request("collect"), shaper?.request("collect")]);
  const chromiumStats = stats.chromium;
  if (!chromiumStats) throw new Error("the server reported no Chromium stats");
  const seconds = viewer.durationMs / 1000;
  const paintedFrames = viewer.paintLatencies.length;
  const bytesPerFrame =
    viewer.receivedFrames > 0 ? viewer.receivedBytes / viewer.receivedFrames : null;
  return {
    uniqueFps: round(paintedFrames / seconds),
    sourceFps: round(viewer.sourceFps),
    recvFps: round(viewer.receivedFrames / seconds),
    staleFrames: viewer.staleFrames,
    paintP50: round(percentile(viewer.paintLatencies, 0.5)),
    paintP95: round(percentile(viewer.paintLatencies, 0.95)),
    paintP99: round(percentile(viewer.paintLatencies, 0.99)),
    kbPerFrame: bytesPerFrame === null ? null : round(bytesPerFrame / 1024),
    mbps: round((viewer.receivedBytes * 8) / 1e6 / seconds, 2),
    serializationMs:
      bytesPerFrame === null || cell.link.shape === null
        ? null
        : round((bytesPerFrame * 8) / (cell.link.shape.mbps * 1e3)),
    cdpFps: round(chromiumStats.frames / (stats.elapsedMs / 1000)),
    motionShare: round(chromiumStats.reducedFrames / Math.max(1, chromiumStats.frames), 2),
    cdpUnackedShare: round(chromiumStats.unackedMs / stats.elapsedMs, 2),
    echoP50: round(percentile(viewer.echoes, 0.5)),
    echoP99: round(percentile(viewer.echoes, 0.99)),
    misreads: viewer.misreads,
    chromiumCpuPct: round((chromiumStats.cpuMs / stats.elapsedMs) * 100),
    ...serverMetrics(stats),
    ...linkMetrics(cell.link, link),
  };
};
export type PreviewMetrics = Awaited<ReturnType<typeof runPreview>>;

export const previewColumns = (stats: Aggregate<PreviewMetrics>) => ({
  "uniq fps (range)": spread(stats, "uniqueFps"),
  "src fps": median(stats, "sourceFps"),
  "recv fps": median(stats, "recvFps"),
  stale: median(stats, "staleFrames"),
  "paint p50 (range)": spread(stats, "paintP50"),
  "paint p95/99": `${median(stats, "paintP95")}/${median(stats, "paintP99")}`,
  "KB/fr": median(stats, "kbPerFrame"),
  Mbps: median(stats, "mbps"),
  "link util": median(stats, "linkUtil"),
  "ser ms/fr": median(stats, "serializationMs"),
  "cdp fps": median(stats, "cdpFps"),
  motion: median(stats, "motionShare"),
  unacked: median(stats, "cdpUnackedShare"),
  "echo p50/99": `${median(stats, "echoP50")}/${median(stats, "echoP99")}`,
  "srv cpu%": median(stats, "serverCpuPct"),
  "chr cpu%": median(stats, "chromiumCpuPct"),
});
