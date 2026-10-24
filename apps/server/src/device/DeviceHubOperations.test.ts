import { expect, it } from "@effect/vitest";
import { LOCAL_DEVICE_HOST_ID } from "@supaterm/contracts";
import * as Effect from "effect/Effect";
import { HttpClient, HttpClientResponse } from "effect/http";

import type { HostDevice } from "./DeviceHost.ts";
import { makeDeviceHubOperations } from "./DeviceHubOperations.ts";

const existingSimulator: HostDevice = {
  id: "used-iphone",
  name: "Used iPhone",
  version: "iOS 27.0",
  platform: "ios",
  booted: true,
  physical: false,
};

const androidDevice: HostDevice = {
  id: "emulator-5554",
  name: "Pixel",
  version: "Android 16",
  platform: "android",
  booted: true,
  physical: false,
};

const fixture = (
  result: { code: number; stdout: string },
  iosAvailable = true,
  simulators: ReadonlyArray<HostDevice> = [existingSimulator],
) => {
  const commands: Array<{ command: string; args: ReadonlyArray<string> }> = [];
  const operations = makeDeviceHubOperations({
    hostId: LOCAL_DEVICE_HOST_ID,
    origin: "http://device.test",
    http: HttpClient.make((request) =>
      Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          Response.json({ simulators, emulators: [androidDevice] }),
        ),
      ),
    ),
    run: (command, args) =>
      Effect.sync(() => {
        commands.push({ command, args });
        return { ...result, stderr: "" };
      }),
    iosAvailable: Effect.succeed(iosAvailable),
    androidAvailable: Effect.succeed(false),
  });
  return { operations, commands };
};

const simulator = (udid: string, state = "Shutdown", isAvailable = true) => ({
  udid,
  name: udid,
  state,
  isAvailable,
});

it.effect("discovers never-used iOS simulators alongside hub devices without duplicates", () =>
  Effect.gen(function* () {
    const { operations, commands } = fixture({
      code: 0,
      stdout: JSON.stringify({
        devices: {
          "com.apple.CoreSimulator.SimRuntime.iOS-27-0": [
            simulator(existingSimulator.id, "Booted"),
            simulator("unused-iphone"),
            simulator("unavailable-iphone", "Shutdown", false),
          ],
          "com.apple.CoreSimulator.SimRuntime.iOS-27-1": [simulator("unused-ipad", "Booted")],
          "com.apple.CoreSimulator.SimRuntime.tvOS-27-0": [simulator("apple-tv")],
        },
      }),
    });

    const listed = yield* operations.list;

    expect(listed.devices).toEqual([
      existingSimulator,
      androidDevice,
      {
        id: "unused-iphone",
        name: "unused-iphone",
        version: "iOS 27.0",
        platform: "ios",
        booted: false,
        physical: false,
      },
      {
        id: "unused-ipad",
        name: "unused-ipad",
        version: "iOS 27.1",
        platform: "ios",
        booted: true,
        physical: false,
      },
    ]);
    expect(listed.detail).toBeUndefined();
    expect(commands).toEqual([
      { command: "xcrun", args: ["simctl", "list", "devices", "available", "--json"] },
    ]);
  }),
);

it.effect("finds iOS simulators when the hub has never listed one", () =>
  Effect.gen(function* () {
    const { operations } = fixture(
      {
        code: 0,
        stdout: JSON.stringify({
          devices: { "com.apple.CoreSimulator.SimRuntime.iOS-27-0": [simulator("new-iphone")] },
        }),
      },
      true,
      [],
    );

    const listed = yield* operations.list;

    expect(listed.devices.map((device) => device.id)).toEqual(["emulator-5554", "new-iphone"]);
    expect(listed.detail).toBeUndefined();
  }),
);

it.effect("does not invoke simctl on hosts without iOS support", () =>
  Effect.gen(function* () {
    const { operations, commands } = fixture({ code: 127, stdout: "" }, false);

    const listed = yield* operations.list;

    expect(listed.devices).toEqual([existingSimulator, androidDevice]);
    expect(listed.detail).toBeUndefined();
    expect(commands).toEqual([]);
  }),
);

it.effect.each([
  { code: 1, stdout: "", warning: "exit code 1" },
  { code: 124, stdout: "", warning: "exit code 124" },
  { code: 0, stdout: "invalid json", warning: "Could not read the iOS Simulator list" },
  { code: 0, stdout: '{"devices":null}', warning: "Could not read the iOS Simulator list" },
])("keeps hub devices when simctl discovery fails: $warning", ({ code, stdout, warning }) =>
  Effect.gen(function* () {
    const { operations } = fixture({ code, stdout });

    const listed = yield* operations.list;

    expect(listed.devices).toEqual([existingSimulator, androidDevice]);
    expect(listed.detail).toContain(warning);
  }),
);
