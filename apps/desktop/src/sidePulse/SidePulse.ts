import {
  DEFAULT_CLIENT_SETTINGS,
  type SidePulseDevice,
  type SidePulseDeviceError,
  type SidePulseDeviceState,
  type SidePulseLedState,
  type SidePulseSettings,
} from "@supaterm/contracts";
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
const OFF_PROGRAM = "off 1s";
const READ_ONLY_CODES: ReadonlySet<unknown> = new Set(["EROFS", "EACCES", "EPERM"]);

const { logInfo, logWarning } = makeComponentLogger("desktop-sidepulse");

type LedCount = SidePulseDevice["ledCount"];

const cyanRoll = (ledCount: LedCount) => {
  const delayMs = ledCount === 2 ? 260 : 95;
  const segments = Array.from(
    { length: ledCount },
    (_, index) => `${index}:#00E5FF 760ms pulse ${index * delayMs}ms`,
  );
  return `off 320ms cosine\n${segments.join("; ")}\nrepeat`;
};

// The animations SidePulse's own agent monitor shows for each state.
const PROGRAMS: Readonly<Record<SidePulseLedState, Readonly<Record<LedCount, string>>>> = {
  idle: {
    2: "off 2s\n0:#006060 1:#006060 2s ease\nrepeat",
    8: "off 2s\n2:#006060 3:#00E5FF 4:#00E5FF 5:#006060 2s ease\nrepeat",
  },
  done: { 2: "#00FF66 320ms cosine", 8: "#00FF66 320ms cosine" },
  working: { 2: cyanRoll(2), 8: cyanRoll(8) },
  attention: { 2: "off\n#FF3A00 1.6s pulse\nrepeat", 8: "off\n#FF3A00 1.6s pulse\nrepeat" },
};

function sidePulseProgram(
  ledState: SidePulseLedState | null,
  ledCount: LedCount,
  brightness: number,
): string {
  if (ledState === null) return OFF_PROGRAM;
  const program = PROGRAMS[ledState][ledCount];
  const level = Math.round((brightness / 100) * 255);
  return level >= 255 ? program : `brightness ${level}\n${program}`;
}

function sidePulseMountRoots(platform: NodeJS.Platform, user: string): ReadonlyArray<string> {
  if (platform === "darwin") return ["/Volumes"];
  if (platform === "linux") {
    return [`/media/${user}`, `/run/media/${user}`, "/media", "/run/media", "/mnt"];
  }
  return [];
}

function ledCountForVolume(name: string): LedCount | null {
  const normalized = name.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
  if (normalized.includes("pulsedot")) return 2;
  if (normalized.includes("sidepulsepro")) return 8;
  return null;
}

function deviceError(error: PlatformError.PlatformError): SidePulseDeviceError {
  const { reason } = error;
  if (reason._tag === "PermissionDenied") return "read-only";
  const code = Predicate.hasProperty(reason.cause, "code") ? reason.cause.code : undefined;
  return READ_ONLY_CODES.has(code) ? "read-only" : "write-failed";
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
  let state: SidePulseDeviceState = { enabled: false, devices: [], ledState };
  const stateListeners = new Set<StateListener>();

  const publish = Effect.suspend(() => {
    const next: SidePulseDeviceState = {
      enabled: settings.enabled,
      devices: Array.from(devices.values(), (tracked) => tracked.device),
      ledState,
    };
    if (Equal.equals(next, state)) return Effect.void;
    state = next;
    return Effect.forEach(stateListeners, (listener) => listener(next), { discard: true });
  });

  const scanMountRoot = (root: string) =>
    fs.readDirectory(root).pipe(
      Effect.orElseSucceed((): ReadonlyArray<string> => []),
      Effect.flatMap((names) =>
        Effect.filter(
          names.flatMap((name) => {
            const ledCount = ledCountForVolume(name);
            return ledCount === null ? [] : [{ name, path: path.join(root, name), ledCount }];
          }),
          // A volume that was not ejected cleanly can leave an empty mount point behind.
          (volume) =>
            fs.exists(path.join(volume.path, LED_FILE)).pipe(Effect.orElseSucceed(() => false)),
        ),
      ),
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
      Effect.catch((error) => Effect.succeed(deviceError(error))),
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
      const program = sidePulseProgram(ledState, volume.ledCount, settings.brightness);
      let tracked: TrackedDevice = previous ?? {
        device: { ...volume, error: null },
        written: null,
        activityAt: now,
      };
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
      } else if (volume.ledCount === 8 && now - tracked.activityAt >= KEEPALIVE_INTERVAL_MS) {
        yield* fs.writeFileString(path.join(volume.path, KEEPALIVE_FILE), "").pipe(Effect.ignore);
        tracked = { ...tracked, activityAt: now };
      }
      next.set(volume.path, tracked);
    }
    devices = next;
    yield* publish;
  });

  const turnOff = Effect.gen(function* () {
    for (const tracked of devices.values()) {
      if (tracked.written !== null) yield* writeLedFile(tracked.device.path, OFF_PROGRAM);
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

  const stop = Effect.gen(function* () {
    const fiber = poller;
    poller = undefined;
    if (fiber !== undefined) yield* Fiber.interrupt(fiber);
    yield* turnOff;
    yield* publish;
  });

  yield* Effect.addFinalizer(() => lock.withPermit(turnOff));

  const configure = Effect.fn("desktop.sidePulse.configure")(function* (next: SidePulseSettings) {
    const previous = settings;
    if (Equal.equals(next, previous)) return;
    yield* lock.withPermit(
      Effect.suspend(() => {
        settings = next;
        if (next.enabled === previous.enabled) return syncDevices;
        return next.enabled ? start : stop;
      }),
    );
  });

  const setLedState = Effect.fn("desktop.sidePulse.setLedState")(function* (
    next: SidePulseLedState | null,
  ) {
    if (next === ledState) return;
    yield* lock.withPermit(
      Effect.suspend(() => {
        ledState = next;
        return syncDevices;
      }),
    );
  });

  return SidePulse.of({
    configure,
    setLedState,
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
