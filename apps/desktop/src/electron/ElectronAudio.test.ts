import * as Effect from "effect/Effect";
import * as HostProcess from "@supaterm/shared/HostProcess";
import { expect } from "vite-plus/test";
import { it } from "@effect/vitest";
import * as Fiber from "effect/Fiber";
import type { Details } from "electron";

import { makeRestart, type ElectronAudioNative } from "./ElectronAudio.ts";

const audio = { pid: 42, type: "Utility", serviceName: "audio.mojom.AudioService" } as const;

type GoneListener = (details: Pick<Details, "type" | "serviceName">) => void;

function makeNative(metrics: ReturnType<ElectronAudioNative["getAppMetrics"]>) {
  const listeners = new Set<GoneListener>();
  const kills: Array<[number, NodeJS.Signals]> = [];
  const killed = Promise.withResolvers<void>();
  const native: ElectronAudioNative = {
    getAppMetrics: () => metrics,
    onChildProcessGone: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    kill: (pid, signal) => {
      kills.push([pid, signal]);
      killed.resolve();
    },
  };
  const emitGone = (details: Pick<Details, "type" | "serviceName">) => {
    for (const listener of listeners) listener(details);
  };
  return { native, listeners, kills, killed: killed.promise, emitGone };
}

it.effect("coalesces recovery and waits for its own audio utility to exit", () =>
  Effect.gen(function* () {
    const fake = makeNative([
      { pid: 1, type: "Utility", serviceName: "network.mojom.NetworkService" },
      { pid: 2, type: "Browser", serviceName: audio.serviceName },
      audio,
    ]);
    const restart = makeRestart(fake.native);
    const pending = yield* Effect.forkChild(
      Effect.all([restart(), restart()], { concurrency: "unbounded" }),
    );
    yield* Effect.promise(() => fake.killed);
    fake.emitGone({ type: "Utility", serviceName: "network.mojom.NetworkService" });
    expect(fake.listeners.size).toBe(1);
    fake.emitGone(audio);
    expect(yield* Fiber.join(pending)).toEqual([true, true]);
    expect(fake.kills).toEqual([[42, "SIGTERM"]]);
    expect(fake.listeners.size).toBe(0);
  }).pipe(Effect.provideService(HostProcess.Platform, "linux")),
);

it.effect.each(["linux", "darwin", "win32"] as const)(
  "leaves other processes alone on %s",
  (platform) =>
    Effect.gen(function* () {
      const fake = makeNative([
        { pid: 1, type: "Utility", serviceName: "network.mojom.NetworkService" },
      ]);
      const restart = makeRestart(fake.native);
      expect(yield* restart().pipe(Effect.provideService(HostProcess.Platform, platform))).toBe(
        false,
      );
      expect(fake.kills).toEqual([]);
    }),
);
