#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalConsole:off - A host-side benchmark driving child processes, sockets and a browser directly.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";

import {
  deviceCellName,
  deviceColumns,
  runDevice,
  type DeviceCell,
  type DeviceMetrics,
} from "./device.ts";
import {
  previewCellName,
  previewColumns,
  runPreview,
  setupPreview,
  WORKLOADS,
  type PreviewCell,
  type PreviewMetrics,
} from "./preview.ts";
import { within, type Link } from "./runner.ts";
import { aggregate, table, type Aggregate } from "./stats.ts";

const USAGE = `Streaming benchmark for the server-browser preview stream and the device hub proxy.

  node scripts/stream-bench/bench.ts [options]

Every run starts a fresh server child (apps/server/scripts/stream-bench-server.ts) with the real
ServerBrowser and /api/preview-stream routes, or the /api/device-hub proxy, from --checkout; a
shaping proxy (shaper.ts) for shaped links; and for the device target a synthetic serve-emu hub
(hub.ts). The preview viewer is the real client-runtime client bundled into a headless page; it
reads a marker the workload page draws every frame back from the painted canvas. Runs of all
cells interleave.

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
Chromium installs once into <tmp>/supaterm-stream-bench, never into ~/.supaterm. A device-only
run neither bundles the preview client nor installs Chromium.`;

const SHUTDOWN_MS = 20_000;
const TARGETS = ["preview", "device"] as const;

const fail = (message: string): never => {
  console.error(`${message}\nRun with --help for usage.`);
  process.exit(2);
};
const parsed = (() => {
  try {
    return NodeUtil.parseArgs({
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
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
})();
const options = parsed.values;
if (options.help) {
  console.log(USAGE);
  process.exit(0);
}

const list = (name: string, value: string) => {
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : fail(`--${name} is empty`);
};
const oneOf = <A extends string>(name: string, value: string, allowed: ReadonlyArray<A>) =>
  list(name, value).map((item) =>
    allowed.includes(item as A)
      ? (item as A)
      : fail(`Unknown --${name} ${item}; expected one of ${allowed.join(", ")}`),
  );
const RULES = {
  positive: "a positive number",
  "non-negative": "a non-negative number",
  integer: "a positive integer",
};
const number = (name: string, text: string, rule: keyof typeof RULES) => {
  const value = Number(text);
  const valid =
    text.trim() !== "" &&
    Number.isFinite(value) &&
    (rule === "non-negative" ? value >= 0 : value > 0) &&
    (rule !== "integer" || Number.isInteger(value));
  return valid ? value : fail(`--${name} must be ${RULES[rule]}, got "${text}"`);
};

const targets = oneOf("target", options.target, TARGETS);
const workloads = oneOf("workload", options.workload, WORKLOADS);
const linkNames = list("link", options.link);
const queues = (fallback: string) =>
  list("queue", options.queue ?? fallback).map((queue) =>
    queue === "unbounded" ? null : number("queue", queue, "positive"),
  );
const links = (queueKiBs: ReadonlyArray<number | null>) =>
  linkNames.flatMap((name): Array<Link> => {
    if (name === "loopback") return [{ name, shape: null }];
    const parts = name.split("/");
    if (parts.length !== 2) return fail(`--link ${name} must be loopback or Mbps/RTT`);
    const mbps = number("link Mbps", parts[0]!, "positive");
    const rttMs = number("link RTT", parts[1]!, "non-negative");
    return queueKiBs.map((queueKiB) => ({ name, shape: { mbps, rttMs, queueKiB } }));
  });
const viewports = list("viewport", options.viewport).map((viewport) => {
  const parts = viewport.split("x");
  if (parts.length !== 2) return fail(`--viewport ${viewport} must be WIDTHxHEIGHT`);
  return {
    width: number("viewport width", parts[0]!, "integer"),
    height: number("viewport height", parts[1]!, "integer"),
  };
});
const runs = number("runs", options.runs, "integer");
const previewConfig = {
  checkout: NodePath.resolve(options.checkout),
  cacheDir: NodePath.join(NodeOS.tmpdir(), "supaterm-stream-bench"),
  warmupMs: number("warmup", options.warmup, "non-negative") * 1000,
  seconds: number("seconds", options.seconds, "positive"),
};
const deviceConfig = {
  ...previewConfig,
  seconds: number("device-seconds", options["device-seconds"], "positive"),
};

interface Outcome<Cell, Metrics> {
  readonly cell: Cell;
  readonly name: string;
  readonly ok: Array<Metrics>;
  readonly errors: Array<string>;
}
const outcome = <Cell, Metrics>(cell: Cell, name: string): Outcome<Cell, Metrics> => ({
  cell,
  name,
  ok: [],
  errors: [],
});
const previewOutcomes = targets.includes("preview")
  ? workloads.flatMap((workload) =>
      links(queues("unbounded")).flatMap((link) =>
        viewports.map(({ width, height }) => {
          const cell: PreviewCell = { target: "preview", workload, link, width, height };
          return outcome<PreviewCell, PreviewMetrics>(cell, previewCellName(cell));
        }),
      ),
    )
  : [];
const deviceOutcomes = targets.includes("device")
  ? links(queues("unbounded,64")).map((link) => {
      const cell: DeviceCell = { target: "device", link };
      return outcome<DeviceCell, DeviceMetrics>(cell, deviceCellName(cell));
    })
  : [];

const cleanup = new AsyncDisposableStack();
let stopping: Promise<boolean> | undefined;
const shutdown = () =>
  (stopping ??= within(
    cleanup.disposeAsync().catch((error: unknown) => console.error(`cleanup failed: ${error}`)),
    SHUTDOWN_MS,
  ));
for (const [signal, code] of [
  ["SIGINT", 130],
  ["SIGTERM", 143],
] as const)
  process.once(signal, () => {
    console.error(`${signal}: stopping`);
    void shutdown().then(() => process.exit(code));
  });

const measure = async <Cell, Metrics>(
  target: Outcome<Cell, Metrics>,
  label: string,
  run: (scope: AsyncDisposableStack) => Promise<Metrics>,
) => {
  if (stopping) return;
  const started = Date.now();
  try {
    await using scope = cleanup.use(new AsyncDisposableStack());
    target.ok.push(await run(scope));
    console.error(`${label} ${target.name} ${Math.round((Date.now() - started) / 1000)}s`);
  } catch (error) {
    target.errors.push(String(error));
    console.error(`${label} ${target.name} failed: ${String(error)}`);
  }
};

const startedAt = new Date().toISOString();
console.error(
  `${previewOutcomes.length + deviceOutcomes.length} cells x ${runs} runs, checkout ${previewConfig.checkout}`,
);
try {
  const preview =
    previewOutcomes.length > 0 ? await setupPreview(cleanup, previewConfig.checkout) : null;
  for (let run = 1; run <= runs; run++) {
    const label = `[${run}/${runs}]`;
    if (preview)
      for (const target of previewOutcomes)
        await measure(target, `${label} preview`, (scope) =>
          runPreview(scope, preview, target.cell, previewConfig),
        );
    for (const target of deviceOutcomes)
      await measure(target, `${label} device`, (scope) =>
        runDevice(scope, target.cell, deviceConfig),
      );
  }
} finally {
  await shutdown();
}

const git = (args: ReadonlyArray<string>) => {
  try {
    return NodeChildProcess.execFileSync("git", ["-C", previewConfig.checkout, ...args], {
      encoding: "utf8",
    }).trim();
  } catch {
    return null;
  }
};
const report = <Cell, Metrics extends Record<keyof Metrics, number | null>>(
  outcomes: ReadonlyArray<Outcome<Cell, Metrics>>,
  prefix: string,
) =>
  outcomes.map(({ cell, name, ok, errors }) => ({
    cell: `${prefix} ${name}`,
    ...cell,
    runs: ok.length,
    errors,
    stats: aggregate(ok),
    perRun: ok,
  }));
const out =
  options.out ??
  NodePath.join(
    previewConfig.cacheDir,
    `results-${startedAt.replaceAll(":", "-").replace(/\..*/, "")}.json`,
  );
NodeFS.mkdirSync(NodePath.dirname(out), { recursive: true });
NodeFS.writeFileSync(
  out,
  JSON.stringify(
    {
      startedAt,
      checkout: previewConfig.checkout,
      commit: git(["rev-parse", "HEAD"]),
      dirty: (git(["status", "--porcelain"]) ?? "").length > 0,
      host: {
        os: `${NodeOS.type()} ${NodeOS.release()} ${NodeOS.machine()}`,
        cpu: NodeOS.cpus()[0]?.model,
        cpus: NodeOS.cpus().length,
        node: process.version,
      },
      options,
      cells: [...report(previewOutcomes, "preview"), ...report(deviceOutcomes, "device")],
    },
    null,
    2,
  ),
);

const rows = <Cell, Metrics extends Record<keyof Metrics, number | null>>(
  outcomes: ReadonlyArray<Outcome<Cell, Metrics>>,
  columns: (stats: Aggregate<Metrics>) => Record<string, string | number | null>,
) => outcomes.map(({ name, ok }) => ({ cell: name, n: ok.length, ...columns(aggregate(ok)) }));
table(rows(previewOutcomes, previewColumns));
table(rows(deviceOutcomes, deviceColumns));
console.log(`results: ${out}`);
