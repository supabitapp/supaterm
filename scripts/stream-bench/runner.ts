// @effect-diagnostics nodeBuiltinImport:off globalTimers:off - Child processes driven over Node IPC.
import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";
import * as NodePerfHooks from "node:perf_hooks";
import * as NodeTimersPromises from "node:timers/promises";

import { round } from "./stats.ts";

const READY_MS = 30_000;
const REQUEST_MS = 60_000;
export const STOP_MS = 5_000;

const stopping = new AbortController();
export const stopSleeps = () => stopping.abort();
export const exitAfter = (ms: number, code: number) =>
  setTimeout(() => process.exit(code), ms).unref();
export const sleep = (ms: number) =>
  NodeTimersPromises.setTimeout(ms, undefined, { signal: stopping.signal });
export const wallNow = () => NodePerfHooks.performance.timeOrigin + NodePerfHooks.performance.now();

export const within = (promise: Promise<unknown>, ms: number) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise.then(
      () => true,
      () => true,
    ),
    new Promise<boolean>((resolve) => {
      timer = setTimeout(resolve, ms, false);
    }),
  ]).finally(() => clearTimeout(timer));
};

interface Pending {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
}

export const spawnChild = async <Ready, Responses>(
  scope: AsyncDisposableStack,
  script: string,
  args: ReadonlyArray<string>,
  options: {
    readonly execArgv?: ReadonlyArray<string>;
    readonly readyMs?: number | undefined;
  } = {},
) => {
  const name = NodePath.basename(script);
  const child = NodeChildProcess.fork(script, args, {
    stdio: ["ignore", "ignore", "inherit", "ipc"],
    execArgv: [...(options.execArgv ?? [])],
  });
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  scope.defer(async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill("SIGTERM");
    if (await within(exited, STOP_MS)) return;
    child.kill("SIGKILL");
    await within(exited, STOP_MS);
  });

  const pending = new Map<number, Pending>();
  let failure: Error | undefined;
  const fail = (error: Error) => {
    failure ??= error;
    for (const entry of pending.values()) entry.reject(failure);
    pending.clear();
  };
  child.once("exit", (code, signal) => fail(new Error(`${name} exited (${signal ?? code})`)));
  child.once("disconnect", () => fail(new Error(`${name} disconnected`)));
  child.on("error", fail);
  child.on("message", (raw) => {
    const message = raw as {
      readonly id: number;
      readonly result?: unknown;
      readonly error?: string;
    };
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.error === undefined) entry.resolve(message.result);
    else entry.reject(new Error(`${name}: ${message.error}`));
  });
  const response = <A>(id: number, label: string, ms: number) =>
    new Promise<A>((resolve, reject) => {
      if (failure) return reject(failure);
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${name} ${label} timed out after ${ms} ms`));
      }, ms);
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value as A);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
    });

  const ready = await response<Ready>(0, "ready", options.readyMs ?? READY_MS);
  let nextId = 0;
  const request = <Type extends keyof Responses & string>(type: Type, extra: object = {}) => {
    const id = ++nextId;
    const result = response<Responses[Type]>(id, type, REQUEST_MS);
    try {
      child.send({ id, type, ...extra }, (error) => error && fail(error));
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
    }
    return result;
  };
  return { ready, request };
};

export interface Shape {
  readonly mbps: number;
  readonly rttMs: number;
  readonly queueKiB: number | null;
}
export interface Link {
  readonly name: string;
  readonly shape: Shape | null;
}
export const queueName = ({ shape }: Link) => {
  if (shape === null) return "-";
  return shape.queueKiB === null ? "unbounded" : `${shape.queueKiB}KiB`;
};

interface ShaperStats {
  readonly queueMaxKiB: number;
  readonly deliveredMbps: number;
}
export const startShaper = async (scope: AsyncDisposableStack, { shape }: Link, port: number) =>
  shape === null
    ? null
    : spawnChild<{ readonly port: number }, { mark: object; collect: ShaperStats }>(
        scope,
        NodePath.join(import.meta.dirname, "shaper.ts"),
        [
          `--target=127.0.0.1:${port}`,
          `--mbps=${shape.mbps}`,
          `--rtt=${shape.rttMs}`,
          `--queue-kib=${shape.queueKiB ?? 0}`,
        ],
      );
export const linkMetrics = ({ shape }: Link, stats: ShaperStats | undefined) => ({
  linkQueueMaxKiB: stats ? round(stats.queueMaxKiB) : null,
  linkUtil: stats && shape ? round(stats.deliveredMbps / shape.mbps, 2) : null,
});

export interface RunConfig {
  readonly checkout: string;
  readonly cacheDir: string;
  readonly warmupMs: number;
  readonly seconds: number;
}
export interface ServerStats {
  readonly elapsedMs: number;
  readonly cpuMs: number;
  readonly rssStart: number;
  readonly rssEnd: number;
  readonly retainedGrowth: number;
  readonly deviceBufferedMax: number;
  readonly deviceBufferedEnd: number;
  readonly chromium: {
    readonly cpuMs: number;
    readonly frames: number;
    readonly reducedFrames: number;
    readonly unackedMs: number;
  } | null;
}
export interface ServerResponses {
  open: { readonly threadId: string; readonly tabId: string };
  mark: object;
  collect: ServerStats;
}
export const startServer = <Ready extends { readonly port: number }>(
  scope: AsyncDisposableStack,
  { checkout, cacheDir }: RunConfig,
  args: ReadonlyArray<string>,
  readyMs?: number,
) =>
  spawnChild<Ready, ServerResponses>(
    scope,
    NodePath.join(import.meta.dirname, "../../apps/server/scripts/stream-bench-server.ts"),
    [`--checkout=${checkout}`, `--cache-dir=${cacheDir}`, ...args],
    { execArgv: ["--expose-gc"], readyMs },
  );

const mb = (bytes: number) => bytes / 1024 / 1024;
export const serverMetrics = (stats: ServerStats) => ({
  serverCpuPct: round((stats.cpuMs / stats.elapsedMs) * 100),
  rssStartMB: round(mb(stats.rssStart)),
  rssEndMB: round(mb(stats.rssEnd)),
  retainedGrowthMB: round(mb(stats.retainedGrowth), 2),
});
