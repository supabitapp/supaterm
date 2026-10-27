// @effect-diagnostics nodeBuiltinImport:off globalTimers:off - Owns a simulator recording process.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";

import { delay, run } from "./process.ts";

export async function recordIos(udid: string, path: string, action: () => Promise<unknown>) {
  const log = NodeFS.openSync(`${path}.log`, "w");
  const child = NodeChildProcess.spawn(
    "xcrun",
    ["simctl", "io", udid, "recordVideo", "--codec=h264", "--force", path],
    { stdio: ["ignore", log, "pipe"] },
  );
  let finished = false;
  const exited = new Promise<Error | null>((resolve) => {
    child.once("error", (error) => {
      finished = true;
      resolve(error);
    });
    child.once("close", (code, signal) => {
      finished = true;
      NodeFS.closeSync(log);
      resolve(
        code === 0 || signal === "SIGINT"
          ? null
          : new Error(`Simulator recording exited (${code ?? signal}); see ${path}.log`),
      );
    });
  });
  const ready = new Promise<void>((resolve, reject) => {
    let started = false;
    let output = "";
    const timeout = setTimeout(
      () => reject(new Error("Simulator recording did not start within 30s")),
      30_000,
    );
    child.stderr!.on("data", (chunk: Buffer) => {
      NodeFS.writeSync(log, chunk);
      output = (output + chunk.toString()).slice(-1_000);
      if (output.includes("Recording started")) {
        started = true;
        clearTimeout(timeout);
        resolve();
      }
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", () => {
      clearTimeout(timeout);
      if (!started)
        reject(new Error(`Simulator recording stopped before capture; see ${path}.log`));
    });
  });
  const stop = async () => {
    if (!finished) child.kill("SIGINT");
    const timeout = setTimeout(() => child.kill("SIGKILL"), 30_000);
    try {
      const error = await exited;
      if (error) throw error;
    } finally {
      clearTimeout(timeout);
    }
  };
  try {
    await ready;
    await action();
    await delay(2_000);
  } catch (error) {
    await stop().catch(() => undefined);
    throw error;
  }
  await stop();
  const { stdout } = await run("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-count_frames",
    "-show_entries",
    "stream=nb_read_frames",
    "-of",
    "csv=p=0",
    path,
  ]);
  if (!(Number(stdout.trim()) >= 2))
    throw new Error(`Recording has fewer than two frames: ${path}`);
  return path;
}
