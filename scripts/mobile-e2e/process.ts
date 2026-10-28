// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off - Host-side device automation uses Node subprocesses.
import * as NodeProcess from "node:process";
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

export const REPO_ROOT = NodePath.resolve(import.meta.dirname, "../..");
export const MOBILE_ROOT = NodePath.join(REPO_ROOT, "apps/mobile");

let runSignal: AbortSignal | undefined;

export function setRunSignal(signal: AbortSignal | undefined) {
  runSignal = signal;
}

export const delay = (ms: number) =>
  new Promise<void>((resolve, reject) => {
    const signal = runSignal;
    if (signal?.aborted) return reject(signal.reason);
    const abort = () => {
      clearTimeout(timeout);
      reject(signal?.reason);
    };
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });

export function run(
  command: string,
  args: ReadonlyArray<string>,
  options: {
    readonly cwd?: string;
    readonly env?: NodeJS.ProcessEnv;
    readonly allowFailure?: boolean;
    readonly timeoutMs?: number;
    readonly logPath?: string;
    readonly processGroup?: boolean;
    readonly signal?: AbortSignal | null;
    readonly onSpawn?: (pid: number) => void;
  } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const signal = options.signal === undefined ? runSignal : options.signal;
    if (signal?.aborted) return reject(signal.reason);
    const log = options.logPath ? NodeFS.createWriteStream(options.logPath, { flags: "a" }) : null;
    const lifecycle = (event: string, details: Record<string, unknown> = {}) => {
      if (log?.writable && !log.writableEnded)
        log.write(`${JSON.stringify({ time: new Date().toISOString(), event, ...details })}\n`);
    };
    const grouped = options.processGroup === true && NodeProcess.platform !== "win32";
    const child = NodeChildProcess.spawn(command, args, {
      cwd: options.cwd ?? REPO_ROOT,
      env: options.env ?? NodeProcess.env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: grouped,
    });
    child.once("spawn", () => {
      lifecycle("spawn", { pid: child.pid });
      if (child.pid) {
        try {
          options.onSpawn?.(child.pid);
        } catch {}
      }
    });
    child.once("exit", (code, signal) => lifecycle("exit", { code, signal }));
    const timeoutMs = options.timeoutMs ?? 120_000;
    let timedOut = false;
    let interrupted = false;
    let forceKill: ReturnType<typeof setTimeout> | undefined;
    const sendSignal = (value: NodeJS.Signals) => {
      try {
        if (grouped && child.pid) NodeProcess.kill(-child.pid, value);
        else child.kill(value);
      } catch {}
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      lifecycle("timeout", { timeoutMs });
      sendSignal("SIGTERM");
      forceKill = setTimeout(() => sendSignal("SIGKILL"), 5_000);
    }, timeoutMs);
    const abort = () => {
      interrupted = true;
      lifecycle("abort");
      clearTimeout(timeout);
      if (forceKill) clearTimeout(forceKill);
      sendSignal("SIGTERM");
      forceKill = setTimeout(() => sendSignal("SIGKILL"), 5_000);
    };
    signal?.addEventListener("abort", abort, { once: true });
    const clearTimers = () => {
      clearTimeout(timeout);
      if (forceKill) clearTimeout(forceKill);
      signal?.removeEventListener("abort", abort);
    };
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = (stdout + chunk.toString()).slice(-1_048_576);
      log?.write(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-1_048_576);
      log?.write(chunk);
    });
    child.once("error", (error) => {
      clearTimers();
      log?.end();
      reject(error);
    });
    child.once("close", (code, exitSignal) => {
      lifecycle("close", { code, signal: exitSignal });
      if ((timedOut || interrupted) && grouped) sendSignal("SIGKILL");
      clearTimers();
      log?.end();
      if (interrupted) {
        reject(signal?.reason);
      } else if (timedOut || (code !== 0 && !options.allowFailure)) {
        reject(
          new Error(
            `${NodePath.basename(command)} ${args.slice(0, 2).join(" ")} ${timedOut ? `timed out after ${timeoutMs}ms` : `failed (${code ?? exitSignal})`}: ${(stderr || stdout).slice(-8_000)}`,
          ),
        );
      } else {
        resolve({ code: code ?? 1, stdout, stderr });
      }
    });
  });
}
