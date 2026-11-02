import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const audio = vi.hoisted(() => {
  type Listener = (status: { didJustFinish: boolean; error: string | null }) => void;
  const createPlayer = () => {
    const listeners = new Set<Listener>();
    return {
      play: vi.fn(),
      pause: vi.fn((_deactivateSession?: boolean) => {}),
      release: vi.fn(),
      addListener: (_event: string, listener: Listener) => {
        listeners.add(listener);
        return { remove: () => listeners.delete(listener) };
      },
      finish: () => {
        for (const listener of listeners) listener({ didJustFinish: true, error: null });
      },
    };
  };
  return {
    createPlayer,
    players: [] as ReturnType<typeof createPlayer>[],
    failNextPlayer: false,
    setSessionOwner: vi.fn((_owned: boolean) => {}),
  };
});
vi.mock("expo-audio", () => ({
  AudioModule: { setAudioSessionOwner: audio.setSessionOwner },
  createAudioPlayer: () => {
    if (audio.failNextPlayer) {
      audio.failNextPlayer = false;
      throw new Error("Player unavailable");
    }
    const player = audio.createPlayer();
    audio.players.push(player);
    return player;
  },
  setAudioModeAsync: async () => {},
  setIsAudioActiveAsync: async () => {},
}));
vi.mock("react-native", () => ({ AppState: { currentState: "active" } }));
vi.hoisted(() => {
  // Metro resolves asset requires to ids; Node would parse the WAV as JavaScript.
  require.extensions[".wav"] = (module) => {
    module.exports = 1;
  };
});

import {
  acquireAudioSession,
  activateAudioSession,
  releaseAudioSession,
} from "../../lib/audioSession";
import { playVoiceInputCue } from "./voiceInputCues";

async function startRecording() {
  const recording = acquireAudioSession("recording");
  await activateAudioSession(recording);
  return recording;
}

describe("voice input cues", () => {
  beforeEach(() => {
    audio.players.length = 0;
  });

  it("silences the start cue before its recording lets the session go", async () => {
    const recording = await startRecording();
    void playVoiceInputCue("start", recording);
    const [start] = audio.players;
    expect(start?.play).toHaveBeenCalled();

    const ending = playVoiceInputCue("stop", recording);
    expect(start?.pause).toHaveBeenCalledWith(false);
    const stop = audio.players[1];
    expect(stop?.play).toHaveBeenCalled();
    stop?.finish();
    await ending;
    await releaseAudioSession(recording);

    expect(audio.players).toHaveLength(2);
  });

  it("lets the recording release its session when a cue cannot play", async () => {
    const recording = await startRecording();
    audio.failNextPlayer = true;
    await playVoiceInputCue("stop", recording);
    audio.setSessionOwner.mockClear();
    await releaseAudioSession(recording);

    expect(audio.setSessionOwner).toHaveBeenLastCalledWith(false);
  });

  it("plays nothing in a recording session that was already released", async () => {
    const recording = await startRecording();
    await releaseAudioSession(recording);
    await playVoiceInputCue("stop", recording);

    expect(audio.players).toEqual([]);
  });
});
