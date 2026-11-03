#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off globalConsole:off - A host-side benchmark driving child processes, sockets and a browser directly.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeHttp from "node:http";
import type * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodePerfHooks from "node:perf_hooks";
import * as NodeUtil from "node:util";

import * as esbuild from "esbuild";
import { chromium, type Browser } from "playwright-core";

const USAGE = `Streaming benchmark for the server-browser preview stream and the device hub proxy.

  node scripts/stream-bench/bench.ts [options]

Every run starts a fresh server child (apps/server/scripts/stream-bench-server.ts) with the real
ServerBrowser, /api/preview-stream/ws and /api/device-hub routes from --checkout, a shaping proxy
(shaper.ts) for shaped links, and for the device target a synthetic serve-emu hub (hub.ts). The
preview viewer is the real client-runtime client bundled into a headless page; it reads a marker
the workload page draws every frame back from the painted canvas. Runs of all cells interleave.

Options (lists are comma separated):
  --target preview,device      what to measure (default both)
  --workload idle,scroll,anim  preview workloads (default all)
  --link loopback,50/150,10/40,5/60
                               links as Mbps/RTT ms; loopback skips the shaper (default all)
  --queue unbounded,64         shaper queue: unbounded, or a bound in KiB
                               (default unbounded for preview, unbounded,64 for device)
  --viewport 1280x800,1440x900 preview viewport in CSS px; frames are 2x (default both)
  --runs 5                     runs per cell
  --seconds 10 --warmup 3      preview measuring window; warmup before either target
  --device-seconds 20          device measuring window
  --checkout <path>            checkout whose server and client to measure (default this one).
                               For a commit: git worktree add ../base <sha>, vp i inside it.
  --out <file>                 results JSON (default under the OS temp dir)

One cell: --target preview --workload scroll --link 10/40 --viewport 1280x800 --runs 5
Chromium installs once into <tmp>/supaterm-stream-bench, never into ~/.supaterm.`;

const { values: options } = NodeUtil.parseArgs({
  options: {
    help: { type: "boolean", short: "h" },
    target: { type: "string", default: "preview,device" },
    workload: { type: "string", default: "idle,scroll,anim" },
    link: { type: "string", default: "loopback,50/150,10/40,5/60" },
    queue: { type: "string" },
    viewport: { type: "string", default: "1280x800,1440x900" },
    runs: { type: "string", default: "5" },
    seconds: { type: "string", default: "10" },
    warmup: { type: "string", default: "3" },
    "device-seconds": { type: "string", default: "20" },
    checkout: { type: "string", default: NodePath.resolve(import.meta.dirname, "../..") },
    out: { type: "string" },
  },
});
if (options.help) {
  console.log(USAGE);
  process.exit(0);
}

const list = (value: string) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
const here = import.meta.dirname;
const checkout = NodePath.resolve(options.checkout);
const cacheDir = NodePath.join(NodeOS.tmpdir(), "supaterm-stream-bench");
const serverScript = NodePath.join(here, "../../apps/server/scripts/stream-bench-server.ts");
const runs = Number(options.runs);
const seconds = Number(options.seconds);
const deviceSeconds = Number(options["device-seconds"]);
const warmupMs = Number(options.warmup) * 1000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const wallNow = () => NodePerfHooks.performance.timeOrigin + NodePerfHooks.performance.now();

interface Link {
  readonly name: string;
  readonly mbps: number;
  readonly rttMs: number;
  readonly queueKiB: number | null;
}
const links = (queues: ReadonlyArray<string>): Array<Link> =>
  list(options.link).flatMap((name): Array<Link> => {
    if (name === "loopback") return [{ name, mbps: 0, rttMs: 0, queueKiB: null }];
    const [mbps, rttMs] = name.split("/").map(Number);
    if (!mbps || rttMs === undefined) throw new Error(`Bad --link ${name}`);
    return queues.map((queue) => ({
      name,
      mbps,
      rttMs,
      queueKiB: queue === "unbounded" ? 0 : Number(queue),
    }));
  });
const queueName = (link: Link) =>
  link.queueKiB === null ? "-" : link.queueKiB === 0 ? "unbounded" : `${link.queueKiB}KiB`;

type Cell =
  | {
      readonly target: "preview";
      readonly workload: string;
      readonly link: Link;
      readonly width: number;
      readonly height: number;
    }
  | { readonly target: "device"; readonly link: Link };
const cellName = (cell: Cell) =>
  cell.target === "preview"
    ? `preview ${cell.workload} ${cell.link.name} ${queueName(cell.link)} ${cell.width}x${cell.height}`
    : `device ${cell.link.name} ${queueName(cell.link)}`;
const targets = list(options.target);
const cells: Array<Cell> = [
  ...(targets.includes("preview")
    ? list(options.workload).flatMap((workload) =>
        links(list(options.queue ?? "unbounded")).flatMap((link) =>
          list(options.viewport).map((viewport) => {
            const [width, height] = viewport.split("x").map(Number);
            if (!width || !height) throw new Error(`Bad --viewport ${viewport}`);
            return { target: "preview" as const, workload, link, width, height };
          }),
        ),
      )
    : []),
  ...(targets.includes("device")
    ? links(list(options.queue ?? "unbounded,64")).map((link) => ({
        target: "device" as const,
        link,
      }))
    : []),
];

// Child processes, each answering IPC requests by id.
interface Ready {
  readonly port: number;
  readonly pid: number;
  readonly executable?: string;
}
const children = new Set<NodeChildProcess.ChildProcess>();
const spawnChild = async (script: string, args: ReadonlyArray<string>) => {
  const child = NodeChildProcess.fork(script, args, {
    stdio: ["ignore", "ignore", "inherit", "ipc"],
    execArgv: ["--expose-gc"],
  });
  children.add(child);
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  void exited.then(() => children.delete(child));
  const pending = new Map<number, (message: { result?: unknown; error?: string }) => void>();
  let nextId = 0;
  const ready = await new Promise<Ready>((resolve, reject) => {
    child.on("message", (raw) => {
      const message = raw as { id?: number; type?: string; result?: unknown; error?: string };
      if (message.type === "ready") resolve(message as unknown as Ready);
      else if (message.id !== undefined) pending.get(message.id)?.(message);
    });
    void exited.then(() => reject(new Error(`${NodePath.basename(script)} exited early`)));
  });
  const request = <A>(type: string, extra: object = {}) =>
    new Promise<A>((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, (message) => {
        pending.delete(id);
        if (message.error) reject(new Error(message.error));
        else resolve(message.result as A);
      });
      child.send({ id, type, ...extra });
    });
  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill("SIGTERM");
    if (await Promise.race([exited.then(() => true), sleep(10_000).then(() => false)])) return;
    child.kill("SIGKILL");
    await exited;
  };
  return { ready, request, stop };
};

// CPU seconds of a process's descendants, which for the server child are Chromium's processes.
const descendants = (rootPid: number) => {
  const rows = NodeChildProcess.execFileSync("ps", ["-A", "-o", "pid=,ppid=,time="], {
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .map((line) => line.trim().split(/\s+/));
  const found = new Map<number, number>();
  const parents = new Set([rootPid]);
  for (let grew = true; grew;) {
    grew = false;
    for (const [pid, ppid, time] of rows) {
      if (!parents.has(Number(ppid)) || found.has(Number(pid)) || !time) continue;
      const seconds = time
        .replace("-", ":")
        .split(":")
        .reverse()
        .reduce((sum, part, index) => sum + Number(part) * [1, 60, 3600, 86400][index]!, 0);
      found.set(Number(pid), seconds);
      parents.add(Number(pid));
      grew = true;
    }
  }
  return found;
};
const cpuSeconds = (processes: Map<number, number>) =>
  [...processes.values()].reduce((sum, value) => sum + value, 0);
const killLeftovers = (pids: Iterable<number>) => {
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }
};

const percentile = (values: ReadonlyArray<number>, p: number) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;
};
const sum = (values: ReadonlyArray<number>) => values.reduce((total, value) => total + value, 0);
const slope = (points: ReadonlyArray<readonly [number, number]>) => {
  if (points.length < 2) return null;
  const meanX = sum(points.map(([x]) => x)) / points.length;
  const meanY = sum(points.map(([, y]) => y)) / points.length;
  const covariance = sum(points.map(([x, y]) => (x - meanX) * (y - meanY)));
  const variance = sum(points.map(([x]) => (x - meanX) ** 2));
  return variance === 0 ? null : covariance / variance;
};
const round = (value: number | null, digits = 1) =>
  value === null || !Number.isFinite(value) ? null : Number(value.toFixed(digits));

interface Sample {
  readonly time: number;
  readonly cpuMs: number;
  readonly rss: number;
  readonly deviceBuffered: number;
}
interface Observed {
  readonly cdpFrames: Array<[number, number, number]>;
  readonly cdpInFlight: Array<[number, number]>;
  readonly previewAckRtts: Array<number>;
  readonly samples: Array<Sample>;
  readonly loopDelayP99Ms: number;
  readonly retained: { readonly start: number; readonly end: number };
}
interface LinkStats {
  readonly queueMeanKiB: number;
  readonly queueMaxKiB: number;
  readonly deliveredMbps: number;
}
const serverStats = (observed: Observed) => {
  const first = observed.samples[0];
  const last = observed.samples.at(-1);
  const mb = (bytes: number) => bytes / 1024 / 1024;
  return {
    serverCpuPct:
      first && last && last.time > first.time
        ? round(((last.cpuMs - first.cpuMs) / (last.time - first.time)) * 100)
        : null,
    loopDelayP99Ms: round(observed.loopDelayP99Ms),
    rssStartMB: first ? round(mb(first.rss)) : null,
    rssEndMB: last ? round(mb(last.rss)) : null,
    rssMaxMB: round(mb(Math.max(0, ...observed.samples.map((sample) => sample.rss)))),
    retainedGrowthMB: round(mb(observed.retained.end - observed.retained.start), 2),
  };
};
const linkStats = (link: Link, stats: LinkStats | undefined) => ({
  linkQueueMeanKiB: stats ? round(stats.queueMeanKiB) : null,
  linkQueueMaxKiB: stats ? round(stats.queueMaxKiB) : null,
  linkUtil: stats ? round(stats.deliveredMbps / link.mbps, 2) : null,
});

// Static pages for both browsers, plus the real preview client bundled from the checkout.
const clientSource = NodePath.join(
  checkout,
  "packages/client-runtime/src/preview/serverBrowserStream.ts",
);
const clientBundle = (
  await esbuild.build({
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
  })
).outputFiles[0]!.text;
const pages: Record<string, readonly [type: string, body: string]> = {
  "/client.js": ["text/javascript", clientBundle],
  "/viewer.js": ["text/javascript", NodeFS.readFileSync(NodePath.join(here, "viewer.js"), "utf8")],
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
    response.writeHead(200, { "content-type": page[0], "cache-control": "no-store" }).end(page[1]);
});
await new Promise<void>((resolve) => pageServer.listen(0, "127.0.0.1", resolve));
const pageOrigin = `http://127.0.0.1:${(pageServer.address() as NodeNet.AddressInfo).port}`;

let viewerBrowser: Promise<Browser> | undefined;

const startServer = (extra: ReadonlyArray<string> = []) =>
  spawnChild(serverScript, ["--checkout", checkout, "--cache-dir", cacheDir, ...extra]);
const startShaper = (link: Link, port: number) =>
  link.queueKiB === null
    ? null
    : spawnChild(NodePath.join(here, "shaper.ts"), [
        "--target",
        `127.0.0.1:${port}`,
        "--mbps",
        String(link.mbps),
        "--rtt",
        String(link.rttMs),
        "--queue-kib",
        String(link.queueKiB),
      ]);

interface ViewerRun {
  readonly startedAt: number;
  readonly stoppedAt: number;
  /** Bytes of each frame received. */
  readonly received: Array<number>;
  /** Marker-to-paint and marker-to-receipt latency of each newly painted marker. */
  readonly painted: Array<[paint: number, receipt: number | null]>;
  readonly echoes: Array<number>;
  readonly misreads: number;
}

const runPreview = async (cell: Extract<Cell, { target: "preview" }>) => {
  const server = await startServer();
  const shaper = await startShaper(cell.link, server.ready.port);
  const origin = `127.0.0.1:${shaper?.ready.port ?? server.ready.port}`;
  let chromiumPids: Map<number, number> = new Map();
  try {
    const { threadId, tabId } = await server.request<{ threadId: string; tabId: string }>("open", {
      url: `${pageOrigin}/workload.html?kind=${cell.workload}`,
    });
    viewerBrowser ??= chromium.launch({ executablePath: server.ready.executable!, headless: true });
    const page = await (
      await viewerBrowser
    ).newPage({ viewport: { width: cell.width, height: cell.height }, deviceScaleFactor: 2 });
    try {
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
      await page.goto(`${pageOrigin}/viewer.html?${query}`);
      await page.waitForFunction("bench.isReady()", undefined, { timeout: 30_000 });
      await sleep(warmupMs);
      const chromiumStart = descendants(server.ready.pid);
      await Promise.all([server.request("mark"), shaper?.request("mark")]);
      await page.evaluate("bench.start()");
      await sleep(seconds * 1000);
      const viewer = await page.evaluate<ViewerRun>("bench.stop()");
      const [observed, link] = await Promise.all([
        server.request<Observed>("collect"),
        shaper?.request<LinkStats>("collect"),
      ]);
      chromiumPids = descendants(server.ready.pid);
      const chromiumCpuPct =
        ((cpuSeconds(chromiumPids) - cpuSeconds(chromiumStart)) /
          ((viewer.stoppedAt - viewer.startedAt) / 1000)) *
        100;
      return summarizePreview(cell, viewer, observed, link, chromiumCpuPct);
    } finally {
      await page.close();
    }
  } finally {
    await shaper?.stop();
    await server.stop();
    killLeftovers(chromiumPids.keys());
  }
};

const summarizePreview = (
  cell: Extract<Cell, { target: "preview" }>,
  viewer: ViewerRun,
  observed: Observed,
  link: LinkStats | undefined,
  chromiumCpuPct: number,
) => {
  const duration = (viewer.stoppedAt - viewer.startedAt) / 1000;
  const bytes = viewer.received;
  const paint = viewer.painted.map(([latency]) => latency);
  const receipt = viewer.painted.flatMap(([, latency]) => (latency === null ? [] : [latency]));
  const inFlight = observed.cdpInFlight;
  let saturated = 0;
  for (let index = 0; index < inFlight.length - 1; index++)
    if (inFlight[index]![1] >= 3) saturated += inFlight[index + 1]![0] - inFlight[index]![0];
  const span = inFlight.length > 1 ? inFlight.at(-1)![0] - inFlight[0]![0] : 0;
  return {
    uniqueFps: round(viewer.painted.length / duration),
    recvFps: round(viewer.received.length / duration),
    recvP50: round(percentile(receipt, 0.5)),
    recvP95: round(percentile(receipt, 0.95)),
    recvP99: round(percentile(receipt, 0.99)),
    paintP50: round(percentile(paint, 0.5)),
    paintP95: round(percentile(paint, 0.95)),
    paintP99: round(percentile(paint, 0.99)),
    kbPerFrame: bytes.length > 0 ? round(sum(bytes) / bytes.length / 1024) : null,
    mbps: round((sum(bytes) * 8) / 1e6 / duration, 2),
    cdpFps: round(observed.cdpFrames.length / duration),
    motionShare: round(
      observed.cdpFrames.filter(([, , maxWidth]) => maxWidth < cell.width * 2).length /
        Math.max(1, observed.cdpFrames.length),
      2,
    ),
    inFlightMax: inFlight.length > 0 ? Math.max(...inFlight.map(([, count]) => count)) : null,
    inFlightSaturatedShare: span > 0 ? round(saturated / span, 2) : null,
    ackRttP50: round(percentile(observed.previewAckRtts, 0.5)),
    ackRttP95: round(percentile(observed.previewAckRtts, 0.95)),
    echoP50: round(percentile(viewer.echoes, 0.5)),
    echoP99: round(percentile(viewer.echoes, 0.99)),
    misreads: viewer.misreads,
    ...serverStats(observed),
    chromiumCpuPct: round(chromiumCpuPct),
    ...linkStats(cell.link, link),
  };
};

const SEMU_MAGIC = 0x53454d55;
const runDevice = async (cell: Extract<Cell, { target: "device" }>) => {
  const hub = await spawnChild(NodePath.join(here, "hub.ts"), []);
  const server = await startServer(["--hub-origin", `http://127.0.0.1:${hub.ready.port}`]);
  const shaper = await startShaper(cell.link, server.ready.port);
  const origin = `127.0.0.1:${shaper?.ready.port ?? server.ready.port}`;
  const frames: Array<[time: number, age: number, bytes: number, sequence: number]> = [];
  let recording = false;
  let closedCode: number | null = null;
  const socket = new WebSocket(
    `ws://${origin}/api/device-hub/vendor/serve-emu/ws?device=bench&frame-meta=1&wsTicket=bench`,
  );
  socket.binaryType = "arraybuffer";
  socket.addEventListener("message", (event) => {
    if (!recording || !(event.data instanceof ArrayBuffer)) return;
    const view = new DataView(event.data);
    if (event.data.byteLength < 20 || view.getUint32(0) !== SEMU_MAGIC) return;
    const time = wallNow();
    frames.push([
      time,
      time - Number(view.getBigUint64(8)) / 1000,
      event.data.byteLength,
      view.getUint32(16),
    ]);
  });
  socket.addEventListener("close", (event) => {
    closedCode = event.code;
  });
  try {
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve);
      socket.addEventListener("error", () => reject(new Error("device socket failed")));
    });
    await sleep(warmupMs);
    await Promise.all([server.request("mark"), hub.request("mark"), shaper?.request("mark")]);
    recording = true;
    const startedAt = wallNow();
    await sleep(deviceSeconds * 1000);
    recording = false;
    const duration = (wallNow() - startedAt) / 1000;
    const [observed, hubStats, link] = await Promise.all([
      server.request<Observed>("collect"),
      hub.request<{
        sentFrames: number;
        droppedFrames: number;
        dropEvents: number;
        slowCloses: number;
        maxBuffered: number;
      }>("collect"),
      shaper?.request<LinkStats>("collect"),
    ]);
    const ages = frames.map(([, age]) => age);
    const window = (from: number, to: number) =>
      percentile(
        frames.flatMap(([time, age]) => (time >= from && time < to ? [age] : [])),
        0.5,
      );
    let gaps = 0;
    for (let index = 1; index < frames.length; index++)
      gaps += frames[index]![3] - frames[index - 1]![3] - 1;
    const buffered = observed.samples.map((sample) => sample.deviceBuffered / 1024 / 1024);
    return {
      recvFps: round(frames.length / duration),
      mbps: round((sum(frames.map(([, , bytes]) => bytes)) * 8) / 1e6 / duration, 2),
      ageP50: round(percentile(ages, 0.5)),
      ageMax: round(percentile(ages, 1)),
      ageFirst2s: round(window(startedAt, startedAt + 2000)),
      ageLast2s: round(window(startedAt + (duration - 2) * 1000, Infinity)),
      ageSlopeMsPerS: round(slope(frames.map(([time, age]) => [time / 1000, age] as const))),
      sequenceGaps: gaps,
      closedCode,
      ...serverStats(observed),
      nodeSocketBufferedMaxMB: round(Math.max(0, ...buffered), 2),
      nodeSocketBufferedEndMB: round(buffered.at(-1) ?? 0, 2),
      hubSentFrames: hubStats.sentFrames,
      hubDroppedFrames: hubStats.droppedFrames,
      hubDropEvents: hubStats.dropEvents,
      hubSlowCloses: hubStats.slowCloses,
      hubMaxBufferedKiB: round(hubStats.maxBuffered / 1024),
      ...linkStats(cell.link, link),
    };
  } finally {
    socket.close();
    await shaper?.stop();
    await server.stop();
    await hub.stop();
  }
};

type Summary = Record<string, number | null>;
const aggregate = (summaries: ReadonlyArray<Summary>) => {
  const keys = new Set(summaries.flatMap((summary) => Object.keys(summary)));
  return Object.fromEntries(
    [...keys].map((key) => {
      const numbers = summaries.flatMap((summary) => {
        const value = summary[key];
        return typeof value === "number" ? [value] : [];
      });
      return [
        key,
        numbers.length === 0
          ? null
          : {
              median: percentile(numbers, 0.5),
              min: Math.min(...numbers),
              max: Math.max(...numbers),
            },
      ];
    }),
  );
};
type Aggregate = ReturnType<typeof aggregate>;
const m = (stats: Aggregate, key: string) => stats[key]?.median ?? null;

// Which bound the delivered frame rate sits on. Stop-and-wait delivers at most one frame per
// viewer ack round trip; Chromium sends at most three unacked frames, acked no sooner than
// 100 ms after each arrives (30 fps); the page itself changes at its own rate.
const SOURCE_FPS: Record<string, number> = { idle: 2, scroll: 60, anim: 60 };
const previewLimiter = (cell: Extract<Cell, { target: "preview" }>, stats: Aggregate) => {
  const recvFps = m(stats, "recvFps");
  const cdpFps = m(stats, "cdpFps");
  const ackRtt = m(stats, "ackRttP50");
  const kbPerFrame = m(stats, "kbPerFrame");
  if (recvFps === null || cdpFps === null || ackRtt === null || kbPerFrame === null)
    return "no frames";
  const source = SOURCE_FPS[cell.workload] ?? 60;
  const stopAndWaitFps = 1000 / ackRtt;
  if (stopAndWaitFps < cdpFps * 0.9 && recvFps >= stopAndWaitFps * 0.8) {
    const serializationMs =
      cell.link.mbps > 0 ? (kbPerFrame * 1024 * 8) / (cell.link.mbps * 1e3) : 0;
    return serializationMs >= ackRtt * 0.5
      ? `bandwidth: ${Math.round(serializationMs)} of ${Math.round(ackRtt)} ms ack RTT is frame serialization`
      : `stop-and-wait RTT: ${Math.round(ackRtt)} ms per frame`;
  }
  if (cdpFps >= source * 0.85) return `source: page changes ${source}/s`;
  const saturated = Math.round((m(stats, "inFlightSaturatedShare") ?? 0) * 100);
  const chromiumCpu = Math.round(m(stats, "chromiumCpuPct") ?? 0);
  return saturated >= 50
    ? `Chromium ack pacing: 3 unacked x 100 ms, slots full ${saturated}% of the time`
    : `Chromium capture: slots full ${saturated}% of the time, Chromium CPU ${chromiumCpu}%`;
};
const deviceVerdict = (stats: Aggregate) => {
  const growth = m(stats, "ageSlopeMsPerS") ?? 0;
  const retained = m(stats, "retainedGrowthMB") ?? 0;
  const age =
    growth > 50
      ? `age grows ${Math.round(growth)} ms/s`
      : `age flat (${m(stats, "ageFirst2s")}->${m(stats, "ageLast2s")} ms)`;
  const where =
    (m(stats, "nodeSocketBufferedEndMB") ?? 0) > 1
      ? `, server socket buffer ${m(stats, "nodeSocketBufferedEndMB")} MB`
      : (m(stats, "linkQueueMaxKiB") ?? 0) > 1024
        ? `, backlog in shaper (${Math.round((m(stats, "linkQueueMaxKiB") ?? 0) / 1024)} MB)`
        : "";
  const guard = (m(stats, "hubDropEvents") ?? 0) > 0 ? ", hub guard fired" : ", hub guard idle";
  return `${age}${where}${guard}${retained > 2 ? `, server retains +${retained} MB` : ""}`;
};

const git = (args: ReadonlyArray<string>) => {
  try {
    return NodeChildProcess.execFileSync("git", ["-C", checkout, ...args], {
      encoding: "utf8",
    }).trim();
  } catch {
    return null;
  }
};

const shutdown = async () => {
  for (const child of children) child.kill("SIGTERM");
  await viewerBrowser?.then((browser) => browser.close()).catch(() => undefined);
  pageServer.close();
};
process.once("SIGINT", () => {
  void shutdown().then(() => process.exit(130));
});

const results = new Map<Cell, Array<Summary | { error: string }>>(cells.map((cell) => [cell, []]));
const startedAt = new Date().toISOString();
console.error(`${cells.length} cells x ${runs} runs, checkout ${checkout}`);
for (let run = 1; run <= runs; run++) {
  for (const cell of cells) {
    const started = Date.now();
    try {
      const summary = cell.target === "preview" ? await runPreview(cell) : await runDevice(cell);
      results.get(cell)!.push(summary);
      console.error(
        `[${run}/${runs}] ${cellName(cell)} ${Math.round((Date.now() - started) / 1000)}s`,
      );
    } catch (error) {
      results.get(cell)!.push({ error: String(error) });
      console.error(`[${run}/${runs}] ${cellName(cell)} failed: ${String(error)}`);
    }
  }
}
await shutdown();

const report = [...results].map(([cell, summaries]) => {
  const ok = summaries.filter((summary): summary is Summary => !("error" in summary));
  const stats = aggregate(ok);
  return {
    cell: cellName(cell),
    ...cell,
    runs: ok.length,
    errors: summaries.flatMap((summary) => ("error" in summary ? [summary.error] : [])),
    limiter:
      ok.length === 0
        ? null
        : cell.target === "preview"
          ? previewLimiter(cell, stats)
          : deviceVerdict(stats),
    stats,
    perRun: ok,
  };
});
const out =
  options.out ??
  NodePath.join(cacheDir, `results-${startedAt.replaceAll(":", "-").replace(/\..*/, "")}.json`);
NodeFS.mkdirSync(NodePath.dirname(out), { recursive: true });
NodeFS.writeFileSync(
  out,
  JSON.stringify(
    {
      startedAt,
      checkout,
      commit: git(["rev-parse", "HEAD"]),
      dirty: (git(["status", "--porcelain"]) ?? "").length > 0,
      host: {
        os: `${NodeOS.type()} ${NodeOS.release()} ${NodeOS.machine()}`,
        cpu: NodeOS.cpus()[0]?.model,
        cpus: NodeOS.cpus().length,
        node: process.version,
      },
      options,
      cells: report,
    },
    null,
    2,
  ),
);

const spread = (stats: Aggregate, key: string) => {
  const value = stats[key];
  return value ? `${value.median} (${value.min}-${value.max})` : "-";
};
const cellsOf = (target: Cell["target"]) => report.filter((row) => row.target === target);
const table = (rows: ReadonlyArray<Record<string, string | number | null>>) => {
  if (rows.length === 0) return;
  const columns = Object.keys(rows[0]!);
  const widths = columns.map((column) =>
    Math.max(column.length, ...rows.map((row) => String(row[column] ?? "-").length)),
  );
  const line = (cellsOfRow: ReadonlyArray<string>) =>
    cellsOfRow.map((text, index) => text.padEnd(widths[index]!)).join("  ");
  console.log(line(columns));
  for (const row of rows) console.log(line(columns.map((column) => String(row[column] ?? "-"))));
  console.log();
};
table(
  cellsOf("preview").map(({ stats, ...row }) => ({
    cell: row.cell.replace(/^preview /, ""),
    n: row.runs,
    "uniq fps": spread(stats, "uniqueFps"),
    "recv p50/95/99": `${m(stats, "recvP50")}/${m(stats, "recvP95")}/${m(stats, "recvP99")}`,
    "paint p50 (range)": spread(stats, "paintP50"),
    "paint p95/99": `${m(stats, "paintP95")}/${m(stats, "paintP99")}`,
    "KB/fr": m(stats, "kbPerFrame"),
    Mbps: m(stats, "mbps"),
    "cdp fps": m(stats, "cdpFps"),
    motion: m(stats, "motionShare"),
    inflight3: m(stats, "inFlightSaturatedShare"),
    ackRTT: m(stats, "ackRttP50"),
    "echo p50/99": `${m(stats, "echoP50")}/${m(stats, "echoP99")}`,
    "srv cpu%": m(stats, "serverCpuPct"),
    "chr cpu%": m(stats, "chromiumCpuPct"),
    limiter: row.limiter,
  })),
);
table(
  cellsOf("device").map(({ stats, ...row }) => ({
    cell: row.cell.replace(/^device /, ""),
    n: row.runs,
    "recv fps": m(stats, "recvFps"),
    Mbps: m(stats, "mbps"),
    "age first->last 2s ms": `${m(stats, "ageFirst2s")}->${m(stats, "ageLast2s")}`,
    "age slope ms/s (range)": spread(stats, "ageSlopeMsPerS"),
    "rss start->end MB": `${m(stats, "rssStartMB")}->${m(stats, "rssEndMB")}`,
    "retained +MB (range)": spread(stats, "retainedGrowthMB"),
    "node sockbuf MB": m(stats, "nodeSocketBufferedEndMB"),
    "hub drops/closes": `${m(stats, "hubDropEvents")}/${m(stats, "hubSlowCloses")}`,
    "shaper q max KiB": m(stats, "linkQueueMaxKiB"),
    verdict: row.limiter,
  })),
);
console.log(`results: ${out}`);
