import { describe, expect, it } from "vite-plus/test";

import { preferredMicrophoneInput } from "./microphonePriority";

const iPhone = { uid: "Built-In Microphone", name: "iPhone Microphone", type: "MicrophoneBuiltIn" };
const airPods = { uid: "airpods", name: "Julius’s AirPods Pro", type: "BluetoothHFP" };
const carPlay = { uid: "carplay", name: "CarPlay", type: "CarAudio" };
const usb = { uid: "usb", name: "Shure MV7", type: "USBAudio" };

describe("preferredMicrophoneInput", () => {
  it("prefers wired, then Bluetooth, then built-in, then CarPlay", () => {
    expect(preferredMicrophoneInput([iPhone, carPlay, airPods, usb])).toBe(usb);
    expect(preferredMicrophoneInput([iPhone, carPlay, airPods])).toBe(airPods);
    expect(preferredMicrophoneInput([carPlay, iPhone])).toBe(iPhone);
    expect(preferredMicrophoneInput([carPlay])).toBe(carPlay);
  });

  it("leaves the route to iOS when no input is a known kind", () => {
    expect(preferredMicrophoneInput([{ uid: "hdmi", name: "Display", type: "HDMI" }])).toBeNull();
  });
});
