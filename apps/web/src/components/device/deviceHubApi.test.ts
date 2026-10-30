import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { subscribeDeviceForeground } from "./deviceHubApi";

describe("foreground app events", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("clears the last app when it exits and ignores malformed events", () => {
    let onMessage: ((event: { data: string }) => void) | null = null;
    const close = vi.fn();
    class FakeEventSource {
      addEventListener(_type: string, listener: (event: { data: string }) => void) {
        onMessage = listener;
      }
      close = close;
    }
    vi.stubGlobal("EventSource", FakeEventSource);
    const onChange = vi.fn();
    const stop = subscribeDeviceForeground(
      {
        platform: "ios",
        deviceId: "test",
        access: { httpBase: "http://test", wsBase: "ws://test", query: {}, credentials: true },
      },
      onChange,
    );
    const emit = (data: unknown) => onMessage?.({ data: JSON.stringify(data) });
    emit({ bundleId: "com.example.app", pid: 123 });
    emit({ bundleId: null });
    emit({ bundleId: "com.example.other" });
    emit({ bundleId: "" });
    emit({ other: "not app state" });
    expect(onChange.mock.calls.map(([app]) => app)).toEqual([
      { id: "com.example.app", pid: 123 },
      null,
      { id: "com.example.other" },
      null,
    ]);
    stop();
    expect(close).toHaveBeenCalledOnce();
  });
});
