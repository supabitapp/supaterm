import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const native = vi.hoisted(() => {
  const listeners = new Set<(frames: { url: string; pcm: string }) => void>();
  return {
    emitFrames: (bytes: number) => {
      const pcm = btoa(String.fromCharCode(...new Uint8Array(bytes)));
      for (const listener of listeners) listener({ url: "file:///recording.wav", pcm });
    },
    module: {
      addListener: (_event: string, listener: (frames: { url: string; pcm: string }) => void) => {
        listeners.add(listener);
        return { remove: () => listeners.delete(listener) };
      },
      prepare: async () => ({ uri: "file:///recording.wav" }),
      record: () => undefined,
      // 200 ms of 16 kHz 16-bit audio: 6,400 bytes.
      stop: async () => ({ uri: "file:///recording.wav", durationMs: 200 }),
      getStatus: () => null,
      release: () => undefined,
    },
  };
});

vi.mock("expo", () => ({ requireOptionalNativeModule: () => native.module }));

import { createPcmVoiceRecorder } from "./pcmVoiceRecorder";

describe("createPcmVoiceRecorder", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stops only once the frames recorded before stopping reached the listener", async () => {
    vi.useFakeTimers();
    const recorder = createPcmVoiceRecorder!();
    await recorder.prepareToRecordAsync();
    const received: Array<number> = [];
    const subscription = recorder.addFrameListener((pcm) => received.push(pcm.byteLength));
    native.emitFrames(3_200);

    let stopped = false;
    const stopping = recorder.stop().then(() => {
      stopped = true;
    });
    await vi.advanceTimersByTimeAsync(900);
    expect(stopped).toBe(false);
    native.emitFrames(3_200);
    await stopping;
    expect(received).toEqual([3_200, 3_200]);
    subscription.remove();
  });
});
