import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as TestClock from "effect/testing/TestClock";

import * as SidePulse from "./SidePulse.ts";

const PRO_WORKING = [
  "off 320ms cosine",
  "0:#00E5FF 760ms pulse 0ms; 1:#00E5FF 760ms pulse 95ms; 2:#00E5FF 760ms pulse 190ms; 3:#00E5FF 760ms pulse 285ms; 4:#00E5FF 760ms pulse 380ms; 5:#00E5FF 760ms pulse 475ms; 6:#00E5FF 760ms pulse 570ms; 7:#00E5FF 760ms pulse 665ms",
  "repeat",
].join("\n");
const DOT_WORKING = [
  "off 320ms cosine",
  "0:#00E5FF 760ms pulse 0ms; 1:#00E5FF 760ms pulse 260ms",
  "repeat",
].join("\n");
const ATTENTION = "off\n#FF3A00 1.6s pulse\nrepeat";

const setup = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "supaterm-sidepulse-test-" });
  const mount = (name: string) =>
    fs
      .makeDirectory(`${root}/${name}`)
      .pipe(Effect.andThen(fs.writeFileString(`${root}/${name}/LEDS.LED`, "")));
  const read = (name: string, file = "LEDS.LED") => fs.readFileString(`${root}/${name}/${file}`);
  const sidePulse = yield* SidePulse.make([root]);
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
      const { fs, root, mount, read, sidePulse } = yield* setup;
      yield* mount("SidePulsePro");
      yield* mount("SidePulseDot");
      yield* mount("Backup");
      yield* fs.makeDirectory(`${root}/SidePulseDot 1`);

      yield* sidePulse.setLedState("working");
      yield* sidePulse.configure({ enabled: true, brightness: 100 });

      assert.strictEqual(yield* read("SidePulsePro"), PRO_WORKING);
      assert.strictEqual(yield* read("SidePulseDot"), DOT_WORKING);
      assert.strictEqual(yield* read("Backup"), "");
      assert.isFalse(yield* fs.exists(`${root}/SidePulseDot 1/LEDS.LED`));
      assert.deepStrictEqual(
        (yield* sidePulse.state).devices.map((device) => [device.name, device.ledCount]),
        [
          ["SidePulseDot", 2],
          ["SidePulsePro", 8],
        ],
      );

      yield* sidePulse.configure({ enabled: true, brightness: 50 });
      assert.strictEqual(yield* read("SidePulseDot"), `brightness 128\n${DOT_WORKING}`);

      yield* sidePulse.setLedState("attention");
      assert.strictEqual(yield* read("SidePulsePro"), `brightness 128\n${ATTENTION}`);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("turns the LEDs off when nothing reports state or SidePulse is turned off", () =>
    Effect.gen(function* () {
      const { mount, read, sidePulse } = yield* setup;
      yield* mount("SidePulseDot");
      yield* sidePulse.configure({ enabled: true, brightness: 100 });
      yield* sidePulse.setLedState("done");
      assert.strictEqual(yield* read("SidePulseDot"), "#00FF66 320ms cosine");

      yield* sidePulse.setLedState(null);
      assert.strictEqual(yield* read("SidePulseDot"), "off 1s");

      yield* sidePulse.setLedState("working");
      yield* sidePulse.configure({ enabled: false, brightness: 100 });
      assert.strictEqual(yield* read("SidePulseDot"), "off 1s");
      assert.deepStrictEqual(yield* sidePulse.state, {
        enabled: false,
        devices: [],
        ledState: "working",
      });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("lights a SidePulse mounted later and keeps a Pro awake", () =>
    Effect.gen(function* () {
      const { fs, root, mount, read, sidePulse, awaitDeviceCount } = yield* setup;
      yield* mount("SidePulsePro");
      yield* sidePulse.setLedState("attention");
      yield* sidePulse.configure({ enabled: true, brightness: 100 });

      yield* mount("SidePulseDot");
      const dotFound = yield* awaitDeviceCount(2);
      yield* TestClock.adjust("2 seconds");
      yield* dotFound;
      assert.strictEqual(yield* read("SidePulseDot"), ATTENTION);
      assert.isFalse(yield* fs.exists(`${root}/SidePulsePro/keepalive`));

      yield* mount("SidePulseDot 2");
      const secondDotFound = yield* awaitDeviceCount(3);
      yield* TestClock.adjust("1 minute");
      yield* secondDotFound;
      assert.strictEqual(yield* read("SidePulsePro", "keepalive"), "");
      assert.isFalse(yield* fs.exists(`${root}/SidePulseDot/keepalive`));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
