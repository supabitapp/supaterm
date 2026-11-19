import { beforeEach, describe, expect, it } from "vite-plus/test";

import { createNotificationAudio } from "./threadNotifications";

const SOUND_SECONDS = 0.6;

const audio = { currentTime: 0, started: 0 };

class FakeAudioContext {
  state = "running";
  destination = {};
  get currentTime() {
    return audio.currentTime;
  }
  resume() {
    return Promise.resolve();
  }
  decodeAudioData() {
    return Promise.resolve({ duration: SOUND_SECONDS });
  }
  createBufferSource() {
    return {
      buffer: null,
      connect() {},
      start() {
        audio.started += 1;
      },
    };
  }
}

const loads = { count: 0, offline: false };

function loadUnlocked() {
  const notifications = createNotificationAudio({
    createContext: () => new FakeAudioContext() as unknown as AudioContext,
    load: async () => {
      loads.count += 1;
      if (loads.offline) throw new Error("offline");
      return new ArrayBuffer(0);
    },
  });
  notifications.unlock();
  return {
    unlockNotificationAudio: notifications.unlock,
    playNotificationSound: notifications.play,
  };
}

beforeEach(() => {
  audio.currentTime = 0;
  audio.started = 0;
  loads.count = 0;
  loads.offline = false;
});

describe("playNotificationSound", () => {
  it("preloads both sounds on unlock and reuses them for playback", async () => {
    const { unlockNotificationAudio, playNotificationSound } = loadUnlocked();
    expect(loads.count).toBe(2);
    unlockNotificationAudio();
    await playNotificationSound("completion", () => true);
    await playNotificationSound("input", () => true);
    expect(loads.count).toBe(2);
    expect(audio.started).toBe(2);
  });

  it("retries failed preloads on an alert rather than every gesture", async () => {
    loads.offline = true;
    const { unlockNotificationAudio, playNotificationSound } = loadUnlocked();
    await playNotificationSound("completion", () => true);
    expect(loads.count).toBe(2);

    unlockNotificationAudio();
    expect(loads.count).toBe(2);

    loads.offline = false;
    await playNotificationSound("completion", () => true);
    expect(loads.count).toBe(3);
    expect(audio.started).toBe(1);
  });

  it("plays one sound for threads that complete together", async () => {
    const { playNotificationSound } = loadUnlocked();

    await Promise.all(
      Array.from({ length: 4 }, () => playNotificationSound("completion", () => true)),
    );

    expect(audio.started).toBe(1);
  });

  it("still plays an input alert over a completion sound", async () => {
    const { playNotificationSound } = loadUnlocked();
    await playNotificationSound("completion", () => true);

    await playNotificationSound("input", () => true);

    expect(audio.started).toBe(2);
  });

  it("leaves the slot free when a sound is turned off before it plays", async () => {
    const { playNotificationSound } = loadUnlocked();
    await playNotificationSound("completion", () => false);

    await playNotificationSound("completion", () => true);

    expect(audio.started).toBe(1);
  });
});
