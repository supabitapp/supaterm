#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalConsole:off globalTimers:off - A host-side probe driving a server child and a headless viewer.
import * as NodeFS from "node:fs";
import * as NodeHttp from "node:http";
import type * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";

import * as esbuild from "esbuild";
import { chromium } from "playwright-core";

import { startServer, within, STOP_MS } from "./runner.ts";

// Time from a key sent after --seconds of --hz pointer input to that key reaching the page.
//   node scripts/stream-bench/input-probe.ts --checkout <worktree> --page scroll|busy|light \
//     --input wheel|pan|movewheel|drag|hover --seconds 5,13 --runs 3

const { values } = NodeUtil.parseArgs({
  options: {
    checkout: { type: "string", default: NodePath.resolve(import.meta.dirname, "../..") },
    seconds: { type: "string", default: "5,13" },
    hz: { type: "string", default: "60" },
    delta: { type: "string", default: "8" },
    runs: { type: "string", default: "1" },
    page: { type: "string", default: "scroll" },
    input: { type: "string", default: "wheel" },
    scale: { type: "string", default: "2" },
  },
});
const checkout = NodePath.resolve(values.checkout);
const durations = values.seconds.split(",").map(Number);
const hz = Number(values.hz);
const delta = Number(values.delta);
const runs = Number(values.runs);
const scale = Number(values.scale);
const cacheDir = NodePath.join(NodeOS.tmpdir(), "supaterm-stream-bench");

const clientSource = NodePath.join(
  checkout,
  "packages/client-runtime/src/preview/serverBrowserStream.ts",
);
const built = await esbuild.build({
  stdin: {
    contents: `export { createPreviewStreamClient } from ${JSON.stringify(clientSource)};`,
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

const LISTENERS = `<script>
const state = { events: 0, wheels: 0, deltaY: 0, firstAt: 0, lastAt: 0, frames: 0, lastX: 0 };
const record = () => {
  const at = Date.now();
  if (!state.firstAt) {
    state.firstAt = at;
    requestAnimationFrame(function count() { if (!state.done) { state.frames++; requestAnimationFrame(count); } });
  }
  state.lastAt = at;
  state.events++;
};
addEventListener("wheel", (event) => {
  if (event.deltaY === 0 && event.deltaX === 0) return;
  record();
  state.wheels++;
  state.deltaY += event.deltaY;
}, { passive: true });
addEventListener("mousemove", (event) => {
  if (event.clientX === 0) return;
  record();
  state.lastX = event.clientX;
});
addEventListener("keydown", (event) => {
  const keyAt = Date.now();
  state.done = true;
  setTimeout(() => {
    fetch("/report", { method: "POST", body: JSON.stringify({ keyAt, key: event.key, scrollY: scrollY, ...state }) });
  }, 1500);
});
</script>`;
const BUSY = `<script>requestAnimationFrame(function burn() { const end = performance.now() + 25; while (performance.now() < end); requestAnimationFrame(burn); });</script>`;
const TARGET =
  values.page === "light" || values.page === "busy"
    ? `<!doctype html><body style="margin:0"><div style="height:400000px;background:linear-gradient(#fff,#000)"></div>${LISTENERS}${values.page === "busy" ? BUSY : ""}</body>`
    : NodeFS.readFileSync(NodePath.join(import.meta.dirname, "workload.html"), "utf8").replace(
        "</body>",
        `${LISTENERS}</body>`,
      );

const VIEWER = `<!doctype html><body><script src="/client.js"></script><script>
const params = new URLSearchParams(location.search);
let ready = false;
let resized = false;
const client = previewStream.createPreviewStreamClient(
  {
    access: { httpBase: params.get("http"), wsBase: params.get("ws"), query: { wsTicket: "probe" }, credentials: false },
    threadId: params.get("threadId"),
    tabId: params.get("tabId"),
    maxWidth: 1280 * Number(params.get("scale")),
    maxHeight: 800 * Number(params.get("scale")),
  },
  {
    onFrame: () => undefined,
    onViewport: (next) => { ready = next.width === 1280 && next.height === 800; },
    onControl: (control) => {
      if (!control.canOperate) return;
      if (control.controller !== "you") client.send({ type: "takeControl" });
      else if (!resized) resized = client.send({ type: "resize", width: 1280, height: 800 });
    },
    onConnectedChange: () => undefined,
    onUnauthorized: () => undefined,
  },
);
globalThis.probe = {
  isReady: () => ready,
  run: (seconds, hz, delta, input) => new Promise((resolve) => {
    const start = performance.now();
    const total = Math.round(seconds * hz);
    let sent = 0;
    const mouse = (action, x, buttons) =>
      client.send({ type: "mouse", action, x, y: 400, button: buttons ? "left" : "none", buttons, clickCount: action === "move" ? 0 : 1, modifiers: 0 });
    if (input === "drag") client.send({ type: "mouse", action: "down", x: 100, y: 400, button: "left", buttons: 1, clickCount: 1, modifiers: 0 });
    const tick = () => {
      const x = 100 + (sent % 1000);
      if (input === "wheel") client.send({ type: "wheel", x: 640, y: 400, deltaX: 0, deltaY: delta, modifiers: 0 });
      else if (input === "movewheel") {
        mouse("move", x, 0);
        client.send({ type: "wheel", x, y: 400, deltaX: 0, deltaY: delta, modifiers: 0 });
      } else if (input === "pan") client.send({ type: "wheel", x, y: 400, deltaX: sent % 2 ? 0.5 : -0.5, deltaY: delta, modifiers: 0 });
      else mouse("move", x, input === "drag" ? 1 : 0);
      sent++;
      if (sent < total) return setTimeout(tick, Math.max(0, start + (sent * 1000) / hz - performance.now()));
      if (input === "drag") mouse("up", x, 0);
      const keySentAt = Date.now();
      client.send({ type: "key", action: "down", key: "a", code: "KeyA", text: "a", modifiers: 0 });
      client.send({ type: "key", action: "up", key: "a", code: "KeyA", modifiers: 0 });
      resolve({ sent, keySentAt, sendMs: performance.now() - start, lastX: x });
    };
    tick();
  }),
};
</script></body>`;

let report: ((value: Record<string, number>) => void) | null = null;
const pages: Record<string, string> = { "/target.html": TARGET, "/viewer.html": VIEWER };
const pageServer = NodeHttp.createServer((request, response) => {
  const path = new URL(request.url ?? "/", "http://probe").pathname;
  if (path === "/report") {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      report?.(JSON.parse(body));
      response.writeHead(204).end();
    });
    return;
  }
  if (path === "/client.js")
    return response
      .writeHead(200, { "content-type": "text/javascript" })
      .end(built.outputFiles[0]!.text);
  const page = pages[path];
  if (!page) return response.writeHead(404).end();
  response.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" }).end(page);
});
await new Promise<void>((resolve) => pageServer.listen(0, "127.0.0.1", resolve));
const pageOrigin = `http://127.0.0.1:${(pageServer.address() as NodeNet.AddressInfo).port}`;

const results = [];
try {
  for (let run = 0; run < runs; run++) {
    for (const seconds of durations) {
      await using scope = new AsyncDisposableStack();
      const server = await startServer<{ readonly port: number; readonly executable: string }>(
        scope,
        { checkout, cacheDir, warmupMs: 0, seconds },
        [],
        6 * 60_000,
      );
      const origin = `127.0.0.1:${server.ready.port}`;
      const { threadId, tabId } = await server.request("open", {
        url: `${pageOrigin}/target.html?kind=scroll`,
      });
      const browser = await chromium.launch({
        executablePath: server.ready.executable,
        headless: true,
      });
      scope.defer(async () => {
        await within(browser.close(), STOP_MS);
      });
      const page = await browser.newPage();
      const query = new URLSearchParams({
        ws: `ws://${origin}/api/preview-stream`,
        http: `http://${origin}/api/preview-stream`,
        threadId,
        tabId,
        scale: String(scale),
      });
      await page.goto(`${pageOrigin}/viewer.html?${query}`);
      await page.waitForFunction("probe.isReady()", undefined, { timeout: 30_000 });
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const reported = new Promise<Record<string, number>>((resolve) => (report = resolve));
      const sent = await page.evaluate<{
        sent: number;
        keySentAt: number;
        sendMs: number;
        lastX: number;
      }>(`probe.run(${seconds}, ${hz}, ${delta}, ${JSON.stringify(values.input)})`);
      const target = await Promise.race([
        reported,
        new Promise<null>((resolve) => setTimeout(resolve, seconds * 3000 + 30_000, null)),
      ]);
      if (!target) throw new Error(`no keydown reached the page within ${seconds * 3 + 30}s`);
      const dispatchSeconds = (target.lastAt - target.firstAt) / 1000;
      const wheel = values.input !== "drag" && values.input !== "hover";
      const row = {
        input: values.input,
        seconds,
        inputHz: Math.round((sent.sent / (sent.sendMs / 1000)) * 10) / 10,
        sent: sent.sent,
        delivered: wheel ? target.wheels : target.events,
        dispatchHz:
          Math.round(((wheel ? target.wheels : target.events) / dispatchSeconds) * 10) / 10,
        pageFps: Math.round((target.frames / dispatchSeconds) * 10) / 10,
        ...(wheel
          ? {
              sentDeltaY: sent.sent * delta,
              pageDeltaY: target.deltaY,
              scrollY: Math.round(target.scrollY),
            }
          : { sentLastX: sent.lastX, pageLastX: target.lastX }),
        keyDelayMs: target.keyAt - sent.keySentAt,
      };
      results.push(row);
      console.log(JSON.stringify(row));
    }
  }
} finally {
  pageServer.closeAllConnections();
  pageServer.close();
}
console.table(results);
