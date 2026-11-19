// @effect-diagnostics nodeBuiltinImport:off -- Short-lived native helper with private stdio, no shell.
// @effect-diagnostics globalTimers:off -- Deadlines bound a native child/overlay; progress is receipt-driven.
import * as NodeChildProcess from "node:child_process";
import * as Schema from "effect/Schema";
import type { LinuxCaptureFeedback, LinuxWindowMetadata } from "./LinuxSnapShot.ts";

const decodeEvent = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Union([
      Schema.Struct({ event: Schema.Literal("ready"), animate: Schema.Boolean }),
      Schema.Struct({ event: Schema.Literals(["landed", "done"]) }),
    ]),
  ),
);

export type FeedbackHelperProcess = {
  readonly stdin: {
    end(data: string): unknown;
    write(data: string): unknown;
    on(event: "error", listener: () => void): unknown;
  };
  readonly stdout: {
    setEncoding(encoding: "utf8"): unknown;
    on(event: "data", listener: (chunk: string) => void): unknown;
  };
  once(event: "error" | "close", listener: () => void): unknown;
  kill(): unknown;
};

export type SpawnFeedbackHelper = (
  executable: string,
  args: ReadonlyArray<string>,
) => FeedbackHelperProcess;

const spawnFeedbackHelper: SpawnFeedbackHelper = (executable, args) =>
  NodeChildProcess.spawn(executable, args, { stdio: ["pipe", "pipe", "ignore"] });

/** Ready and landed are compositor receipts. A requested animation is not proof it started. */
export async function startNativeCaptureFeedback(
  executable: string,
  directory: string,
  options: { bounds: LinuxWindowMetadata["bounds"]; pid: number; flash: boolean; animate: boolean },
  spawn: SpawnFeedbackHelper = spawnFeedbackHelper,
) {
  const child = spawn(executable, ["feedback", directory, JSON.stringify(options)]);
  const ready = Promise.withResolvers<boolean | undefined>();
  const landed = Promise.withResolvers<void>();
  const exited = Promise.withResolvers<void>();
  let closed = false;
  let closing = false;
  let flying = false;
  let buffer = "";
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const close = () => {
    if (closing || closed) return;
    closing = true;
    ready.resolve(undefined);
    landed.resolve();
    child.stdin.end('{"command":"close"}\n');
    killTimer = setTimeout(() => child.kill(), 1000);
    killTimer.unref();
  };
  const deadline = setTimeout(close, 10_000);
  deadline.unref();
  const readyDeadline = setTimeout(close, 2000);
  readyDeadline.unref();
  child.stdin.on("error", close);
  child.once("error", close);
  child.once("close", () => {
    closed = true;
    clearTimeout(deadline);
    clearTimeout(readyDeadline);
    if (killTimer) clearTimeout(killTimer);
    ready.resolve(undefined);
    landed.resolve();
    exited.resolve();
  });
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    if (buffer.length > 4096) return close();
    let end: number;
    while ((end = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      try {
        const event = decodeEvent(line);
        switch (event.event) {
          case "ready":
            clearTimeout(readyDeadline);
            ready.resolve(event.animate);
            break;
          case "landed":
            landed.resolve();
            break;
          case "done":
            close();
            break;
        }
      } catch {
        close();
      }
    }
  });
  const animationStarted = await ready.promise;
  if (animationStarted === undefined) {
    close();
    await exited.promise;
    return undefined;
  }
  return {
    animationStarted,
    closed: exited.promise,
    async animateTo(title: string, frame: Parameters<LinuxCaptureFeedback["animateTo"]>[0]) {
      if (closing || closed || !animationStarted) return;
      if (!flying) {
        flying = true;
        child.stdin.write(`${JSON.stringify({ command: "animate", title, frame })}\n`);
      }
      await landed.promise;
    },
    async complete() {
      if (flying) await landed.promise;
      close();
      await exited.promise;
    },
    close,
  };
}

export type CaptureHelperExecFile = (
  executable: string,
  args: ReadonlyArray<string>,
  options: {
    readonly timeout: number;
    readonly maxBuffer: number;
    readonly encoding: "utf8";
    readonly signal?: AbortSignal;
  },
  callback: (error: Error | null, stdout: string, stderr: string) => void,
) => void;

export type CaptureHelperNative = {
  readonly execFile: CaptureHelperExecFile;
  readonly startFeedback: typeof startNativeCaptureFeedback;
};

export const nodeCaptureHelperNative: CaptureHelperNative = {
  execFile: (executable, args, options, callback) => {
    NodeChildProcess.execFile(executable, [...args], options, callback);
  },
  startFeedback: (executable, directory, options) =>
    startNativeCaptureFeedback(executable, directory, options),
};
