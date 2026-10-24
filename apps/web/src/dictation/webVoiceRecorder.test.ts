import { afterEach, expect, it, vi } from "vite-plus/test";

import { WebVoiceRecorder } from "./webVoiceRecorder";

afterEach(() => vi.unstubAllGlobals());

function deferred<A = void>() {
  let resolve: (value: A) => void = () => undefined;
  const promise = new Promise<A>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

it("closes a microphone granted after its recording was cancelled", async () => {
  const requested = deferred();
  const microphone = deferred<MediaStream>();
  const stop = vi.fn();
  vi.stubGlobal("window", { localStorage: { getItem: () => null } });
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: () => {
        requested.resolve();
        return microphone.promise;
      },
    },
  });
  const recorder = new WebVoiceRecorder({ onStatus: vi.fn() });
  const permission = recorder.requestPermission();
  await requested.promise;
  recorder.releaseIfUnused();
  microphone.resolve({ getTracks: () => [{ stop }] } as unknown as MediaStream);
  await expect(permission).resolves.toEqual({ granted: false, canAskAgain: true });
  expect(stop).toHaveBeenCalledOnce();
});
