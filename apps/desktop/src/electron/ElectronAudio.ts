// @effect-diagnostics globalTimers:off -- The shared native restart deadline must outlive individual IPC callers.
// @effect-diagnostics nodeBuiltinImport:off -- Only Electron's main process can restart its Chromium audio utility.
import * as NodeProcess from "node:process";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as HostProcess from "@supaterm/shared/HostProcess";
import { app, type Details, type Event, type ProcessMetric } from "electron";

class AudioServiceRestartError extends Schema.TaggedError<AudioServiceRestartError>()(
  "AudioServiceRestartError",
  { cause: Schema.Defect() },
) {}

export type ElectronAudioNative = {
  readonly getAppMetrics: () => ReadonlyArray<Pick<ProcessMetric, "pid" | "type" | "serviceName">>;
  readonly onChildProcessGone: (
    listener: (details: Pick<Details, "type" | "serviceName">) => void,
  ) => () => void;
  readonly kill: (pid: number, signal: NodeJS.Signals) => void;
};

const electronAudioNative: ElectronAudioNative = {
  getAppMetrics: () => app.getAppMetrics(),
  onChildProcessGone: (listener) => {
    const onGone = (_event: Event, details: Details) => listener(details);
    app.on("child-process-gone", onGone);
    return () => app.removeListener("child-process-gone", onGone);
  },
  kill: (pid, signal) => NodeProcess.kill(pid, signal),
};

export const makeRestart = (native: ElectronAudioNative) => {
  let pendingRestart: Promise<boolean> | undefined;
  return Effect.fn("ElectronAudio.restart")(function* () {
    if ((yield* HostProcess.Platform) !== "linux") return false;
    return yield* Effect.tryPromise({
      try: () => {
        if (pendingRestart) return pendingRestart;
        const audio = native
          .getAppMetrics()
          .find(
            (metric) =>
              metric.type === "Utility" && metric.serviceName === "audio.mojom.AudioService",
          );
        if (!audio) return Promise.resolve(false);
        pendingRestart = new Promise<boolean>((resolve, reject) => {
          const cleanup = () => {
            clearTimeout(timer);
            unsubscribe();
          };
          const unsubscribe = native.onChildProcessGone((details) => {
            if (details.type === "Utility" && details.serviceName === audio.serviceName) {
              cleanup();
              resolve(true);
            }
          });
          const timer = setTimeout(() => {
            cleanup();
            resolve(false);
          }, 5_000);
          try {
            native.kill(audio.pid, "SIGTERM");
          } catch (cause) {
            cleanup();
            reject(cause);
          }
        }).finally(() => {
          pendingRestart = undefined;
        });
        return pendingRestart;
      },
      catch: (cause) => new AudioServiceRestartError({ cause }),
    }).pipe(
      Effect.catch((cause) =>
        Effect.logWarning("Could not restart the audio service", cause).pipe(Effect.as(false)),
      ),
    );
  });
};

export const restart = makeRestart(electronAudioNative);
