import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { type MicrophoneInput, openMicrophone, resolveMicrophone } from "./microphone";

const builtIn = { deviceId: "mac", label: "MacBook Pro Microphone (Built-in)" };
const airPods = { deviceId: "pods", label: "AirPods Pro (Bluetooth)" };
const usb = { deviceId: "yeti", label: "Yeti Stereo Microphone (046d:0ab7)" };
const virtual = { deviceId: "zoom", label: "ZoomAudioDevice (Virtual)" };
const chromiumDefault = (input: MicrophoneInput) => ({
  deviceId: "default",
  label: `Default - ${input.label}`,
});
const choose = (input: MicrophoneInput) => ({ deviceId: input.deviceId, label: input.label });

describe("resolveMicrophone", () => {
  it.each([
    {
      name: "follows a system default that isn't Bluetooth",
      inputs: [chromiumDefault(usb), builtIn, usb],
      chosen: null,
      avoidBluetooth: true,
      route: { deviceId: null, input: usb, chosenMissing: false, passedOver: null },
    },
    {
      name: "opens the chosen microphone",
      inputs: [chromiumDefault(builtIn), builtIn, usb],
      chosen: choose(usb),
      avoidBluetooth: true,
      route: { deviceId: "yeti", input: usb, chosenMissing: false, passedOver: null },
    },
    {
      name: "finds the chosen microphone by label after the browser reissues its id",
      inputs: [chromiumDefault(builtIn), builtIn, { ...usb, deviceId: "yeti-2" }],
      chosen: choose(usb),
      avoidBluetooth: true,
      route: {
        deviceId: "yeti-2",
        input: { ...usb, deviceId: "yeti-2" },
        chosenMissing: false,
        passedOver: null,
      },
    },
    {
      name: "uses the system default while the chosen microphone is unplugged",
      inputs: [chromiumDefault(builtIn), builtIn],
      chosen: choose(usb),
      avoidBluetooth: true,
      route: { deviceId: null, input: builtIn, chosenMissing: true, passedOver: null },
    },
    {
      name: "passes over a Bluetooth default for the built-in microphone",
      inputs: [chromiumDefault(airPods), usb, airPods, builtIn],
      chosen: null,
      avoidBluetooth: true,
      route: { deviceId: "mac", input: builtIn, chosenMissing: false, passedOver: airPods },
    },
    {
      name: "passes over a Bluetooth default for a real input when there is no built-in one",
      inputs: [chromiumDefault(airPods), airPods, virtual, usb],
      chosen: null,
      avoidBluetooth: true,
      route: { deviceId: "yeti", input: usb, chosenMissing: false, passedOver: airPods },
    },
    {
      name: "keeps a Bluetooth default when no real input can stand in",
      inputs: [chromiumDefault(airPods), airPods, virtual],
      chosen: null,
      avoidBluetooth: true,
      route: { deviceId: null, input: airPods, chosenMissing: false, passedOver: null },
    },
    {
      name: "keeps a Bluetooth default with the setting off",
      inputs: [chromiumDefault(airPods), airPods, builtIn],
      chosen: null,
      avoidBluetooth: false,
      route: { deviceId: null, input: airPods, chosenMissing: false, passedOver: null },
    },
    {
      name: "never passes over a chosen Bluetooth microphone",
      inputs: [chromiumDefault(builtIn), builtIn, airPods],
      chosen: choose(airPods),
      avoidBluetooth: true,
      route: { deviceId: "pods", input: airPods, chosenMissing: false, passedOver: null },
    },
    {
      name: "passes over a Bluetooth default standing in for an unplugged choice",
      inputs: [chromiumDefault(airPods), airPods, builtIn],
      chosen: choose(usb),
      avoidBluetooth: true,
      route: { deviceId: "mac", input: builtIn, chosenMissing: true, passedOver: airPods },
    },
    {
      name: "takes the first input as the default where the browser lists no alias",
      inputs: [{ deviceId: "a", label: "MacBook Pro Microphone" }, usb],
      chosen: null,
      avoidBluetooth: true,
      route: {
        deviceId: null,
        input: { deviceId: "a", label: "MacBook Pro Microphone" },
        chosenMissing: false,
        passedOver: null,
      },
    },
    {
      name: "tries the chosen id while the browser hides its labels",
      inputs: [{ deviceId: "", label: "" }],
      chosen: choose(usb),
      avoidBluetooth: true,
      route: { deviceId: "yeti", input: null, chosenMissing: false, passedOver: null },
    },
  ])("$name", ({ inputs, chosen, avoidBluetooth, route }) => {
    expect(resolveMicrophone(inputs, { chosen, avoidBluetooth })).toEqual(route);
  });
});

describe("openMicrophone", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const stubMediaDevices = (failure: string) => {
    const stream = { id: "stream" };
    const getUserMedia = vi.fn(async (constraints: MediaStreamConstraints) => {
      const audio = constraints.audio;
      if (typeof audio === "object" && audio.deviceId !== undefined) {
        throw Object.assign(new Error(failure), { name: failure });
      }
      return stream;
    });
    vi.stubGlobal("navigator", {
      mediaDevices: {
        enumerateDevices: async () =>
          [chromiumDefault(builtIn), builtIn, usb].map((input) => ({
            ...input,
            kind: "audioinput",
          })),
        getUserMedia,
      },
    });
    return { stream, getUserMedia };
  };

  it.each(["OverconstrainedError", "NotFoundError", "NotReadableError"])(
    "falls back to the default when the chosen input fails with %s",
    async (failure) => {
      const { stream, getUserMedia } = stubMediaDevices(failure);
      await expect(openMicrophone({ chosen: choose(usb), avoidBluetooth: true })).resolves.toBe(
        stream,
      );
      expect(getUserMedia.mock.calls.map(([constraints]) => constraints.audio)).toEqual([
        expect.objectContaining({ deviceId: { exact: "yeti" } }),
        expect.not.objectContaining({ deviceId: expect.anything() }),
      ]);
    },
  );

  it("does not fall back when microphone access is denied", async () => {
    const { getUserMedia } = stubMediaDevices("NotAllowedError");
    await expect(openMicrophone({ chosen: choose(usb), avoidBluetooth: true })).rejects.toThrow(
      "NotAllowedError",
    );
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });
});
