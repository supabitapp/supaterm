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

  const hidden = [{ deviceId: "", label: "" }];
  const requested = (constraints: MediaStreamConstraints) => {
    const audio = constraints.audio;
    if (typeof audio !== "object") return null;
    const deviceId = audio.deviceId;
    if (typeof deviceId !== "object" || Array.isArray(deviceId)) return null;
    return typeof deviceId.exact === "string" ? deviceId.exact : null;
  };

  const stubMediaDevices = (options: {
    readonly listings: ReadonlyArray<ReadonlyArray<MicrophoneInput>>;
    readonly failures?: Readonly<Record<string, string>>;
  }) => {
    let listed = 0;
    const requests: Array<string | null> = [];
    const stopped: Array<string> = [];
    vi.stubGlobal("navigator", {
      mediaDevices: {
        enumerateDevices: async () => {
          const listing = options.listings[Math.min(listed, options.listings.length - 1)] ?? [];
          listed += 1;
          return listing.map((input) => ({ ...input, kind: "audioinput" }));
        },
        getUserMedia: async (constraints: MediaStreamConstraints) => {
          const exact = requested(constraints);
          requests.push(exact);
          const failure = exact === null ? undefined : options.failures?.[exact];
          if (failure) throw Object.assign(new Error(failure), { name: failure });
          const deviceId = exact ?? "default";
          const track = { getSettings: () => ({ deviceId }), stop: () => stopped.push(deviceId) };
          return { getAudioTracks: () => [track], getTracks: () => [track] };
        },
      },
    });
    return { requests, stopped };
  };
  const openedDevice = (stream: MediaStream) => stream.getAudioTracks()[0]?.getSettings().deviceId;

  it.each(["OverconstrainedError", "NotFoundError", "NotReadableError"])(
    "leaves out a chosen input that fails with %s and resolves the rest again",
    async (failure) => {
      const { requests } = stubMediaDevices({
        listings: [[chromiumDefault(airPods), airPods, usb, builtIn]],
        failures: { yeti: failure },
      });
      const stream = await openMicrophone({ chosen: choose(usb), avoidBluetooth: true });
      expect(requests).toEqual(["yeti", "mac"]);
      expect(openedDevice(stream)).toBe("mac");
    },
  );

  it("opens the browser default once no other input can stand in", async () => {
    const { requests } = stubMediaDevices({
      listings: [[chromiumDefault(builtIn), builtIn, usb]],
      failures: { yeti: "NotReadableError" },
    });
    const stream = await openMicrophone({ chosen: choose(usb), avoidBluetooth: true });
    expect(requests).toEqual(["yeti", null]);
    expect(openedDevice(stream)).toBe("default");
  });

  it("resolves again once access exposes the labels", async () => {
    const { requests, stopped } = stubMediaDevices({
      listings: [hidden, [chromiumDefault(airPods), airPods, builtIn]],
    });
    const stream = await openMicrophone({ chosen: null, avoidBluetooth: true });
    expect(requests).toEqual([null, "mac"]);
    expect(stopped).toEqual(["default"]);
    expect(openedDevice(stream)).toBe("mac");
  });

  it("keeps the first stream when the exposed labels resolve to it", async () => {
    const { requests } = stubMediaDevices({
      listings: [hidden, [chromiumDefault(builtIn), builtIn, airPods]],
    });
    await openMicrophone({ chosen: null, avoidBluetooth: true });
    expect(requests).toEqual([null]);
  });

  it("does not fall back when microphone access is denied", async () => {
    const { requests } = stubMediaDevices({
      listings: [[chromiumDefault(builtIn), builtIn, usb]],
      failures: { yeti: "NotAllowedError" },
    });
    await expect(openMicrophone({ chosen: choose(usb), avoidBluetooth: true })).rejects.toThrow(
      "NotAllowedError",
    );
    expect(requests).toEqual(["yeti"]);
  });
});
