import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as PlatformError from "effect/PlatformError";
import * as TestClock from "effect/testing/TestClock";

import * as SidePulse from "./SidePulse.ts";

const WORKING = [
  "off 320ms cosine",
  "0:#00E5FF 760ms pulse 0ms; 1:#00E5FF 760ms pulse 95ms; 2:#00E5FF 760ms pulse 190ms; 3:#00E5FF 760ms pulse 285ms; 4:#00E5FF 760ms pulse 380ms; 5:#00E5FF 760ms pulse 475ms; 6:#00E5FF 760ms pulse 570ms; 7:#00E5FF 760ms pulse 665ms",
  "repeat",
].join("\n");
const ATTENTION = "off\n#FF3A00 1.6s pulse\nrepeat";

const setup = Effect.fn("setup")(function* (
  serviceFileSystem: (fs: FileSystem.FileSystem) => FileSystem.FileSystem = (fs) => fs,
) {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "supaterm-sidepulse-test-" });
  const mount = (name: string) =>
    fs
      .makeDirectory(`${root}/${name}`)
      .pipe(Effect.andThen(fs.writeFileString(`${root}/${name}/LEDS.LED`, "")));
  const read = (name: string, file = "LEDS.LED") => fs.readFileString(`${root}/${name}/${file}`);
  const sidePulse = yield* SidePulse.make([root]).pipe(
    Effect.provideService(FileSystem.FileSystem, serviceFileSystem(fs)),
  );
  const awaitDeviceCount = Effect.fn("awaitDeviceCount")(function* (count: number) {
    const reached = yield* Deferred.make<void>();
    yield* sidePulse.subscribeState((state) =>
      state.devices.length === count ? Deferred.succeed(reached, undefined) : Effect.void,
    );
    return Deferred.await(reached);
  });
  return { fs, root, mount, read, sidePulse, awaitDeviceCount };
});

describe("SidePulse", () => {
  it.effect("writes the most urgent agent state to every mounted SidePulse", () =>
    Effect.gen(function* () {
      const { fs, root, mount, read, sidePulse } = yield* setup();
      yield* mount("SidePulse");
      yield* mount("SidePulse Pro");
      yield* mount("SidePulseDot");
      yield* mount("Backup");
      yield* fs.makeDirectory(`${root}/SidePulse 1`);

      yield* sidePulse.setLedState("working");
      yield* sidePulse.configure({ enabled: true, brightness: 100 });

      assert.strictEqual(yield* read("SidePulse"), WORKING);
      assert.strictEqual(yield* read("SidePulse Pro"), WORKING);
      assert.strictEqual(yield* read("SidePulseDot"), "");
      assert.strictEqual(yield* read("Backup"), "");
      assert.isFalse(yield* fs.exists(`${root}/SidePulse 1/LEDS.LED`));
      assert.deepStrictEqual(
        (yield* sidePulse.state).devices.map((device) => device.name),
        ["SidePulse", "SidePulse Pro"],
      );

      yield* sidePulse.configure({ enabled: true, brightness: 50 });
      assert.strictEqual(yield* read("SidePulse"), `brightness 128\n${WORKING}`);

      yield* sidePulse.setLedState("attention");
      assert.strictEqual(yield* read("SidePulse Pro"), `brightness 128\n${ATTENTION}`);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("turns the LEDs off when nothing reports state or SidePulse is turned off", () =>
    Effect.gen(function* () {
      const { mount, read, sidePulse } = yield* setup();
      yield* mount("SidePulse");
      yield* sidePulse.configure({ enabled: true, brightness: 100 });
      yield* sidePulse.setLedState("done");
      assert.strictEqual(yield* read("SidePulse"), "#00FF66 320ms cosine");

      yield* sidePulse.setLedState(null);
      assert.strictEqual(yield* read("SidePulse"), "off 1s");

      yield* sidePulse.setLedState("working");
      yield* sidePulse.configure({ enabled: false, brightness: 100 });
      assert.strictEqual(yield* read("SidePulse"), "off 1s");
      assert.deepStrictEqual(yield* sidePulse.state, {
        enabled: false,
        devices: [],
        ledState: "working",
      });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("opens no volume until SidePulse is turned on", () =>
    Effect.gen(function* () {
      const touched: Array<string> = [];
      const { root, mount, sidePulse } = yield* setup((fs) => ({
        ...fs,
        readDirectory: (path, options) => {
          touched.push(path);
          return fs.readDirectory(path, options);
        },
        access: (path, options) => {
          touched.push(path);
          return fs.access(path, options);
        },
        open: (path, options) => {
          touched.push(path);
          return fs.open(path, options);
        },
      }));
      yield* mount("SidePulse");
      yield* mount("Backup");

      yield* sidePulse.setLedState("working");
      yield* sidePulse.configure({ enabled: false, brightness: 50 });
      yield* TestClock.adjust("1 minute");
      assert.deepStrictEqual(touched, []);

      yield* sidePulse.configure({ enabled: true, brightness: 50 });
      assert.deepStrictEqual(touched, [
        root,
        `${root}/SidePulse/LEDS.LED`,
        `${root}/SidePulse/LEDS.LED`,
      ]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("reports a SidePulse macOS won't let Supaterm open, and lights it once allowed", () =>
    Effect.gen(function* () {
      let allowed = false;
      const { mount, read, sidePulse } = yield* setup((fs) => ({
        ...fs,
        access: (path, options) =>
          allowed
            ? fs.access(path, options)
            : Effect.fail(
                PlatformError.systemError({
                  _tag: "Unknown",
                  module: "FileSystem",
                  method: "access",
                  pathOrDescriptor: path,
                  cause: Object.assign(new Error("EPERM: operation not permitted"), {
                    code: "EPERM",
                  }),
                }),
              ),
      }));
      yield* mount("SidePulse");
      yield* sidePulse.setLedState("attention");
      yield* sidePulse.configure({ enabled: true, brightness: 100 });
      assert.deepStrictEqual(
        (yield* sidePulse.state).devices.map((device) => device.error),
        ["access-denied"],
      );
      assert.strictEqual(yield* read("SidePulse"), "");

      allowed = true;
      yield* sidePulse.setLedState("working");
      assert.deepStrictEqual(
        (yield* sidePulse.state).devices.map((device) => device.error),
        [null],
      );
      assert.strictEqual(yield* read("SidePulse"), WORKING);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("still turns the LEDs off after a later write fails", () =>
    Effect.gen(function* () {
      let failWrites = false;
      const { mount, read, sidePulse } = yield* setup((fs) => ({
        ...fs,
        open: (path, options) =>
          failWrites
            ? Effect.fail(
                PlatformError.systemError({
                  _tag: "Busy",
                  module: "FileSystem",
                  method: "open",
                  pathOrDescriptor: path,
                }),
              )
            : fs.open(path, options),
      }));
      yield* mount("SidePulse");
      yield* sidePulse.setLedState("working");
      yield* sidePulse.configure({ enabled: true, brightness: 100 });
      assert.strictEqual(yield* read("SidePulse"), WORKING);

      failWrites = true;
      yield* sidePulse.setLedState("attention");
      assert.deepStrictEqual(
        (yield* sidePulse.state).devices.map((device) => device.error),
        ["write-failed"],
      );

      failWrites = false;
      yield* sidePulse.configure({ enabled: false, brightness: 100 });
      assert.strictEqual(yield* read("SidePulse"), "off 1s");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("turns the LEDs off when the window closes behind a queued update", () =>
    Effect.gen(function* () {
      const { mount, read, sidePulse } = yield* setup();
      yield* mount("SidePulse");
      const scanning = yield* Deferred.make<void>();
      const releaseScan = yield* Deferred.make<void>();
      let held = false;
      yield* sidePulse.subscribeState(() => {
        if (held) return Effect.void;
        held = true;
        return Deferred.succeed(scanning, undefined).pipe(
          Effect.andThen(Deferred.await(releaseScan)),
        );
      });

      const enabling = yield* Effect.forkChild(
        sidePulse.configure({ enabled: true, brightness: 100 }),
      );
      yield* Deferred.await(scanning);
      // Each update runs until it waits on the scan still holding the device lock.
      const working = yield* Effect.forkChild(sidePulse.setLedState("working"), {
        startImmediately: true,
      });
      const windowClosed = yield* Effect.forkChild(sidePulse.setLedState(null), {
        startImmediately: true,
      });
      yield* Deferred.succeed(releaseScan, undefined);
      yield* Fiber.joinAll([enabling, working, windowClosed]);

      assert.strictEqual(yield* read("SidePulse"), "off 1s");
      assert.strictEqual((yield* sidePulse.state).ledState, null);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("lights a SidePulse mounted later and keeps it awake", () =>
    Effect.gen(function* () {
      const { fs, root, mount, read, sidePulse, awaitDeviceCount } = yield* setup();
      yield* mount("SidePulse");
      yield* sidePulse.setLedState("attention");
      yield* sidePulse.configure({ enabled: true, brightness: 100 });

      yield* mount("SidePulse 1");
      const secondFound = yield* awaitDeviceCount(2);
      yield* TestClock.adjust("2 seconds");
      yield* secondFound;
      assert.strictEqual(yield* read("SidePulse 1"), ATTENTION);
      assert.isFalse(yield* fs.exists(`${root}/SidePulse/keepalive`));

      yield* mount("SidePulse 2");
      const thirdFound = yield* awaitDeviceCount(3);
      yield* TestClock.adjust("1 minute");
      yield* thirdFound;
      assert.strictEqual(yield* read("SidePulse", "keepalive"), "");
      assert.isFalse(yield* fs.exists(`${root}/SidePulse 2/keepalive`));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
