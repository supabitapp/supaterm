import {
  DEFAULT_CLIENT_SETTINGS,
  type SidePulseDevice,
  type SidePulseDeviceError,
  type SidePulseDeviceState,
  type SidePulseLedState,
  type SidePulseSettings,
} from "@supaterm/contracts";
import {
  SIDE_PULSE_OFF_PROGRAM,
  sidePulsePreviewMs,
  sidePulseProgram,
} from "@supaterm/shared/sidePulsePrograms";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import type * as PlatformError from "effect/PlatformError";
import * as Predicate from "effect/Predicate";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import { makeComponentLogger } from "../app/DesktopObservability.ts";

const SCAN_INTERVAL = Duration.seconds(2);
// The MacBook SD card reader powers SidePulse Pro off after three minutes without file activity.
const KEEPALIVE_INTERVAL_MS = 60_000;
const LED_FILE = "LEDS.LED";
const KEEPALIVE_FILE = "keepalive";
const PERMISSION_CODES: ReadonlySet<unknown> = new Set(["EACCES", "EPERM"]);

const { logInfo, logWarning } = makeComponentLogger("desktop-sidepulse");

function sidePulseMountRoots(platform: NodeJS.Platform, user: string): ReadonlyArray<string> {
  if (platform === "darwin") return ["/Volumes"];
  if (platform === "linux") {
    return [`/media/${user}`, `/run/media/${user}`, "/media", "/run/media", "/mnt"];
  }
  return [];
}

// SidePulse Pro ships with the FAT12 volume label "SidePulse"; a trailing number is a duplicate mount.
const SIDE_PULSE_PRO_VOLUME = /^sidepulse(?:pro)?\d*$/;

function isSidePulseVolume(name: string): boolean {
  return SIDE_PULSE_PRO_VOLUME.test(name.toLowerCase().replaceAll(/[^a-z0-9]/g, ""));
}

function errorCode(error: PlatformError.PlatformError): unknown {
  const { cause } = error.reason;
  return Predicate.hasProperty(cause, "code") ? cause.code : undefined;
}

// macOS answers EPERM for a removable volume the user has not allowed Supaterm to open.
function isPermissionDenied(error: PlatformError.PlatformError): boolean {
  return error.reason._tag === "PermissionDenied" || PERMISSION_CODES.has(errorCode(error));
}

function writeError(error: PlatformError.PlatformError): SidePulseDeviceError {
  return isPermissionDenied(error) || errorCode(error) === "EROFS" ? "read-only" : "write-failed";
}

interface MountedVolume {
  readonly name: string;
  readonly path: string;
  readonly denied: boolean;
}

interface TrackedDevice {
  readonly device: SidePulseDevice;
  readonly written: string | null;
  readonly activityAt: number;
}

type StateListener = (state: SidePulseDeviceState) => Effect.Effect<void>;

export class SidePulse extends Context.Service<
  SidePulse,
  {
    /** Cheap and idempotent: runs on every client-settings write. */
    readonly configure: (settings: SidePulseSettings) => Effect.Effect<void>;
    readonly setLedState: (ledState: SidePulseLedState | null) => Effect.Effect<void>;
    readonly preview: (light: SidePulseLedState) => Effect.Effect<void>;
    readonly state: Effect.Effect<SidePulseDeviceState>;
    readonly subscribeState: (listener: StateListener) => Effect.Effect<void, never, Scope.Scope>;
  }
>()("@supaterm/desktop/sidePulse/SidePulse") {}

export const make = Effect.fn("SidePulse.make")(function* (mountRoots: ReadonlyArray<string>) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const serviceScope = yield* Effect.scope;
  const lock = yield* Semaphore.make(1);
  const encoder = new TextEncoder();

  let settings = DEFAULT_CLIENT_SETTINGS.sidePulse;
  let ledState: SidePulseLedState | null = null;
  let devices = new Map<string, TrackedDevice>();
  let poller: Fiber.Fiber<void> | undefined;
  let preview: SidePulseLedState | null = null;
  let previewTimer: Fiber.Fiber<void> | undefined;
  let state: SidePulseDeviceState = { enabled: false, devices: [], ledState, preview };
  const stateListeners = new Set<StateListener>();

  const publish = Effect.suspend(() => {
    const next: SidePulseDeviceState = {
      enabled: settings.enabled,
      devices: Array.from(devices.values(), (tracked) => tracked.device),
      ledState,
      preview,
    };
    if (Equal.equals(next, state)) return Effect.void;
    state = next;
    return Effect.forEach(stateListeners, (listener) => listener(next), { discard: true });
  });

  // Opening the volume is what asks macOS for removable-volume access, so it only runs
  // for volumes named like a SidePulse and only while SidePulse is on.
  const probeVolume = (volume: Omit<MountedVolume, "denied">) =>
    fs.access(path.join(volume.path, LED_FILE)).pipe(
      Effect.as<ReadonlyArray<MountedVolume>>([{ ...volume, denied: false }]),
      // A volume that was not ejected cleanly can leave an empty mount point behind.
      Effect.catch((error) =>
        Effect.succeed(isPermissionDenied(error) ? [{ ...volume, denied: true }] : []),
      ),
    );

  const scanMountRoot = (root: string) =>
    fs.readDirectory(root).pipe(
      Effect.orElseSucceed((): ReadonlyArray<string> => []),
      Effect.flatMap((names) =>
        Effect.forEach(
          names.flatMap((name) =>
            isSidePulseVolume(name) ? [{ name, path: path.join(root, name) }] : [],
          ),
          probeVolume,
        ),
      ),
      Effect.map((volumes) => volumes.flat()),
    );

  const writeLedFile = (volume: string, program: string) =>
    Effect.scoped(
      Effect.gen(function* () {
        const file = yield* fs.open(path.join(volume, LED_FILE), { flag: "w" });
        yield* file.writeAll(encoder.encode(program));
        // Removable volumes buffer writes; the firmware only sees what reaches the device.
        yield* file.sync.pipe(Effect.ignore);
      }),
    ).pipe(
      Effect.as(null),
      Effect.catch((error) => Effect.succeed(writeError(error))),
    );

  const syncDevices = Effect.gen(function* () {
    if (!settings.enabled) return yield* publish;
    const found = (yield* Effect.forEach(mountRoots, scanMountRoot)).flat();
    const now = yield* Clock.currentTimeMillis;
    const next = new Map<string, TrackedDevice>();
    for (const volume of found) {
      if (next.has(volume.path)) continue;
      const previous = devices.get(volume.path);
      if (previous === undefined) yield* logInfo("device mounted", { path: volume.path });
      const device: SidePulseDevice = {
        name: volume.name,
        path: volume.path,
        error: volume.denied ? "access-denied" : (previous?.device.error ?? null),
      };
      if (volume.denied) {
        if (previous?.device.error !== "access-denied") {
          yield* logWarning("not allowed to open the volume", { path: volume.path });
        }
        next.set(volume.path, { device, written: null, activityAt: now });
        continue;
      }
      const program = sidePulseProgram(preview ?? ledState, settings);
      let tracked: TrackedDevice = previous ?? { device, written: null, activityAt: now };
      if (tracked.written !== program) {
        const error = yield* writeLedFile(volume.path, program);
        if (error !== null && error !== tracked.device.error) {
          yield* logWarning("could not write the LED program", { path: volume.path, error });
        }
        tracked = {
          device: { ...tracked.device, error },
          written: error === null ? program : null,
          activityAt: error === null ? now : tracked.activityAt,
        };
      } else if (now - tracked.activityAt >= KEEPALIVE_INTERVAL_MS) {
        yield* fs.writeFileString(path.join(volume.path, KEEPALIVE_FILE), "").pipe(Effect.ignore);
        tracked = { ...tracked, activityAt: now };
      }
      next.set(volume.path, tracked);
    }
    devices = next;
    yield* publish;
  });

  const turnOff = Effect.gen(function* () {
    // A failed write can follow one that lit the device, so only volumes never opened are skipped.
    for (const { device } of devices.values()) {
      if (device.error !== "access-denied")
        yield* writeLedFile(device.path, SIDE_PULSE_OFF_PROGRAM);
    }
    devices = new Map();
  });

  const start = Effect.gen(function* () {
    yield* syncDevices;
    poller = yield* Effect.forkIn(
      Effect.forever(
        Effect.sleep(SCAN_INTERVAL).pipe(Effect.andThen(lock.withPermit(syncDevices))),
      ),
      serviceScope,
    );
  });

  const endPreview = Effect.gen(function* () {
    const timer = previewTimer;
    previewTimer = undefined;
    preview = null;
    if (timer !== undefined) yield* Fiber.interrupt(timer);
  });

  const stop = Effect.gen(function* () {
    const fiber = poller;
    poller = undefined;
    if (fiber !== undefined) yield* Fiber.interrupt(fiber);
    yield* endPreview;
    yield* turnOff;
    yield* publish;
  });

  yield* Effect.addFinalizer(() => lock.withPermit(turnOff));

  // Compare under the lock: a queued update must not hide a later one that undoes it.
  const configure = Effect.fn("desktop.sidePulse.configure")(function* (next: SidePulseSettings) {
    yield* lock.withPermit(
      Effect.suspend(() => {
        const previous = settings;
        if (Equal.equals(next, previous)) return Effect.void;
        settings = next;
        if (next.enabled === previous.enabled) return syncDevices;
        return next.enabled ? start : stop;
      }),
    );
  });

  const setLedState = Effect.fn("desktop.sidePulse.setLedState")(function* (
    next: SidePulseLedState | null,
  ) {
    yield* lock.withPermit(
      Effect.suspend(() => {
        // A preview ends with the window that asked for it, so the LEDs go dark with that window.
        const endingPreview = next === null && preview !== null;
        if (next === ledState && !endingPreview) return Effect.void;
        ledState = next;
        return endingPreview ? Effect.andThen(endPreview, syncDevices) : syncDevices;
      }),
    );
  });

  // A newer preview restarts the timer, so the last pick plays for its full length.
  const previewLight = Effect.fn("desktop.sidePulse.preview")(function* (light: SidePulseLedState) {
    yield* lock.withPermit(
      Effect.gen(function* () {
        if (!settings.enabled || ledState === null) return;
        yield* endPreview;
        preview = light;
        yield* syncDevices;
        previewTimer = yield* Effect.forkIn(
          Effect.sleep(Duration.millis(sidePulsePreviewMs(settings.effects[light]))).pipe(
            Effect.andThen(
              lock.withPermit(
                Effect.suspend(() => {
                  preview = null;
                  previewTimer = undefined;
                  return syncDevices;
                }),
              ),
            ),
          ),
          serviceScope,
        );
      }),
    );
  });

  return SidePulse.of({
    configure,
    setLedState,
    preview: previewLight,
    state: Effect.sync(() => state),
    subscribeState: Effect.fn("SidePulse.subscribeState")(function (listener) {
      return Effect.acquireRelease(
        Effect.sync(() => {
          stateListeners.add(listener);
        }),
        () =>
          Effect.sync(() => {
            stateListeners.delete(listener);
          }),
      );
    }),
  });
});

export const layer = Layer.effect(
  SidePulse,
  Effect.gen(function* () {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    return yield* make(
      sidePulseMountRoots(
        environment.platform,
        environment.path.basename(environment.homeDirectory),
      ),
    );
  }),
);
