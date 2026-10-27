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
  } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const log = options.logPath ? NodeFS.createWriteStream(options.logPath, { flags: "a" }) : null;
    const child = NodeChildProcess.spawn(command, args, {
      cwd: options.cwd ?? REPO_ROOT,
      env: options.env ?? NodeProcess.env,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: options.timeoutMs ?? 120_000,
    });
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
      log?.end();
      reject(error);
    });
    child.once("close", (code, signal) => {
      log?.end();
      if (code !== 0 && !options.allowFailure) {
        reject(
          new Error(
            `${NodePath.basename(command)} ${args[0] ?? ""} failed (${code ?? signal}): ${(stderr || stdout).slice(-8_000)}`,
          ),
        );
      } else {
        resolve({ code: code ?? 1, stdout, stderr });
      }
    });
  });
}
