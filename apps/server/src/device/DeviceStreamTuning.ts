import type { DeviceHostId } from "@supaterm/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

import * as DeviceService from "./DeviceService.ts";

const EncoderSettings = Schema.Struct({
  maxDimension: Schema.Number,
  h264Bitrate: Schema.Number,
});
type EncoderSettings = typeof EncoderSettings.Type;

const ENCODER_STEPS: ReadonlyArray<EncoderSettings> = [
  { maxDimension: 960, h264Bitrate: 1_000_000 },
  { maxDimension: 1280, h264Bitrate: 1_500_000 },
  { maxDimension: 1600, h264Bitrate: 2_500_000 },
  { maxDimension: 1920, h264Bitrate: 3_500_000 },
];
const LARGEST_STEP = ENCODER_STEPS[ENCODER_STEPS.length - 1]!;
const SETTLE = "1 second";
const HUB_REQUEST_TIMEOUT = "5 seconds";

const encoderSettingsFor = (displayEdges: ReadonlyArray<number | null>): EncoderSettings | null => {
  const known = displayEdges.filter((edge) => edge !== null);
  if (known.length === 0 || known.length !== displayEdges.length) return null;
  const largest = Math.max(...known);
  return ENCODER_STEPS.find((step) => step.maxDimension >= largest) ?? LARGEST_STEP;
};

const sameSettings = (left: EncoderSettings | null, right: EncoderSettings | null) =>
  left?.maxDimension === right?.maxDimension && left?.h264Bitrate === right?.h264Bitrate;

export interface DeviceStreamViewer {
  readonly hostId: DeviceHostId;
  readonly deviceId: string;
  /** Longest side the viewer draws the screen at, in device pixels. */
  readonly displayEdge: number | null;
}

interface TunedDevice {
  readonly hostId: DeviceHostId;
  readonly deviceId: string;
  readonly viewers: Set<DeviceStreamViewer>;
  readonly applying: Semaphore.Semaphore;
  generation: number;
  baseline: EncoderSettings | null;
  applied: EncoderSettings | null;
}

export class DeviceStreamTuning extends Context.Service<
  DeviceStreamTuning,
  {
    readonly watch: (viewer: DeviceStreamViewer) => Effect.Effect<void, never, Scope.Scope>;
  }
>()("supaterm/device/DeviceStreamTuning") {}

const make = Effect.gen(function* () {
  const devices = yield* DeviceService.DeviceService;
  const client = yield* HttpClient.HttpClient;
  const serviceScope = yield* Effect.scope;
  const tuned = new Map<string, TunedDevice>();

  const apply = Effect.fn("DeviceStreamTuning.apply")(
    function* (device: TunedDevice) {
      const ready = yield* devices.currentReadiness(device.hostId);
      if (!ready || ready.upstream) return;
      const url = `${ready.hub.origin}/vendor/serve-sim/helper/${encodeURIComponent(device.deviceId)}/stream-settings`;
      const target = encoderSettingsFor([...device.viewers].map((viewer) => viewer.displayEdge));
      if (target !== null && device.baseline === null) {
        const current = yield* client
          .get(url)
          .pipe(
            Effect.flatMap(HttpClientResponse.filterStatusOk),
            Effect.flatMap(HttpClientResponse.schemaBodyJson(EncoderSettings)),
            Effect.timeout(HUB_REQUEST_TIMEOUT),
          );
        device.baseline = { maxDimension: current.maxDimension, h264Bitrate: current.h264Bitrate };
        device.applied = device.baseline;
      }
      const next = target ?? device.baseline;
      if (next === null || sameSettings(next, device.applied)) return;
      yield* client
        .execute(HttpClientRequest.patch(url).pipe(HttpClientRequest.bodyJsonUnsafe(next)))
        .pipe(
          Effect.flatMap(HttpClientResponse.filterStatusOk),
          Effect.timeout(HUB_REQUEST_TIMEOUT),
        );
      device.applied = next;
    },
    Effect.catch((cause) => Effect.logWarning("device stream tuning failed", { cause })),
  );

  const forgetIfRestored = (key: string, device: TunedDevice) =>
    Effect.sync(() => {
      const restored = device.baseline === null || sameSettings(device.applied, device.baseline);
      if (device.viewers.size === 0 && restored && tuned.get(key) === device) tuned.delete(key);
    });

  const schedule = (key: string, device: TunedDevice) => {
    const generation = ++device.generation;
    return Effect.sleep(SETTLE).pipe(
      Effect.andThen(
        Effect.suspend(() =>
          generation === device.generation
            ? device.applying
                .withPermits(1)(apply(device))
                .pipe(Effect.ensuring(forgetIfRestored(key, device)))
            : Effect.void,
        ),
      ),
      Effect.forkIn(serviceScope),
      Effect.asVoid,
    );
  };

  const watch: DeviceStreamTuning["Service"]["watch"] = (viewer) => {
    const key = `${viewer.hostId}\u0000${viewer.deviceId}`;
    return Effect.acquireRelease(
      Effect.suspend(() => {
        const device = tuned.get(key) ?? {
          hostId: viewer.hostId,
          deviceId: viewer.deviceId,
          viewers: new Set<DeviceStreamViewer>(),
          applying: Semaphore.makeUnsafe(1),
          generation: 0,
          baseline: null,
          applied: null,
        };
        tuned.set(key, device);
        device.viewers.add(viewer);
        return schedule(key, device).pipe(Effect.as(device));
      }),
      (device) =>
        Effect.suspend(() => {
          device.viewers.delete(viewer);
          return schedule(key, device);
        }),
    ).pipe(Effect.asVoid);
  };

  return DeviceStreamTuning.of({ watch });
});

export const layer = Layer.effect(DeviceStreamTuning, make);
