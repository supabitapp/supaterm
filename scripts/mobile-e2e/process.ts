// @effect-diagnostics nodeBuiltinImport:off globalTimers:off - Host-side device automation uses Node subprocesses.
import * as NodeProcess from "node:process";
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

export const REPO_ROOT = NodePath.resolve(import.meta.dirname, "../..");
export const MOBILE_ROOT = NodePath.join(REPO_ROOT, "apps/mobile");

export const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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
  } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const log = options.logPath ? NodeFS.createWriteStream(options.logPath, { flags: "a" }) : null;
    const grouped = options.processGroup === true && NodeProcess.platform !== "win32";
    const child = NodeChildProcess.spawn(command, args, {
      cwd: options.cwd ?? REPO_ROOT,
      env: options.env ?? NodeProcess.env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: grouped,
    });
    const timeoutMs = options.timeoutMs ?? 120_000;
    let timedOut = false;
    let forceKill: ReturnType<typeof setTimeout> | undefined;
    const sendSignal = (value: NodeJS.Signals) => {
      try {
        if (grouped && child.pid) NodeProcess.kill(-child.pid, value);
        else child.kill(value);
      } catch {}
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      sendSignal("SIGTERM");
      forceKill = setTimeout(() => sendSignal("SIGKILL"), 5_000);
    }, timeoutMs);
    const clearTimers = () => {
      clearTimeout(timeout);
      if (forceKill) clearTimeout(forceKill);
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
    child.once("close", (code, signal) => {
      if (timedOut && grouped) sendSignal("SIGKILL");
      clearTimers();
      log?.end();
      if (timedOut || (code !== 0 && !options.allowFailure)) {
        reject(
          new Error(
            `${NodePath.basename(command)} ${args.slice(0, 2).join(" ")} ${timedOut ? `timed out after ${timeoutMs}ms` : `failed (${code ?? signal})`}: ${(stderr || stdout).slice(-8_000)}`,
          ),
        );
      } else {
        resolve({ code: code ?? 1, stdout, stderr });
      }
    });
  });
}
