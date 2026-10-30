import type { CodexMicroDeviceState } from "@supaterm/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { act, render } from "../../../test/render";
import { useCodexMicroDeviceState } from "./codexMicroStore";

const bridge = vi.hoisted(() => ({
  getState: vi.fn<() => Promise<CodexMicroDeviceState>>(),
  onStateChange: vi.fn<(listener: (state: CodexMicroDeviceState) => void) => () => void>(),
  onInput: vi.fn(() => () => {}),
  setLighting: vi.fn(async () => {}),
}));

vi.mock(import("./codexMicroBridge"), () => ({
  getCodexMicroBridge: () => bridge,
}));

const connected: CodexMicroDeviceState = {
  status: "connected",
  controlPlane: "available",
  error: null,
  battery: null,
  firmwareVersion: null,
  inputMonitoring: "granted",
};

function DeviceState() {
  const state = useCodexMicroDeviceState();
  return <output>{state?.status ?? "loading"}</output>;
}

function setup() {
  let resolve!: (state: CodexMicroDeviceState) => void;
  const promise = new Promise<CodexMicroDeviceState>((complete) => {
    resolve = complete;
  });
  const initial = { promise, resolve };
  const unsubscribe = vi.fn();
  let publish: (state: CodexMicroDeviceState) => void = () => {};
  bridge.getState.mockReturnValue(initial.promise);
  bridge.onStateChange.mockImplementation((listener) => {
    publish = listener;
    return unsubscribe;
  });
  return { initial, unsubscribe, publish: (state: CodexMicroDeviceState) => publish(state) };
}

describe("keyboard device state", () => {
  it("shows the initial state and subsequent device updates, then unsubscribes", async () => {
    const { initial, publish, unsubscribe } = setup();
    await using screen = await render(<DeviceState />, { router: false });
    await expect.element(screen.getByText("loading")).toBeInTheDocument();

    await act(() => initial.resolve(connected));
    await expect.element(screen.getByText("connected")).toBeInTheDocument();

    await act(() => publish({ ...connected, status: "not-detected" }));
    await expect.element(screen.getByText("not-detected")).toBeInTheDocument();
    await screen.unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("keeps a pushed update when the initial request returns older state", async () => {
    const { initial, publish } = setup();
    await using screen = await render(<DeviceState />, { router: false });
    await act(() => publish(connected));
    await act(() => initial.resolve({ ...connected, status: "not-detected" }));
    await expect.element(screen.getByText("connected")).toBeInTheDocument();
  });
});
