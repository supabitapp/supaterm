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
    setSessionOwner: vi.fn((_owned: boolean) => {}),
  };
});
vi.mock("expo-audio", () => ({
  AudioModule: { setAudioSessionOwner: audio.setSessionOwner },
  createAudioPlayer: () => {
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
import { playVoiceInputCue, playVoiceInputCueInRecording } from "./voiceInputCues";

async function startRecording() {
  const recording = acquireAudioSession("recording");
  await activateAudioSession(recording);
  return recording;
}

describe("voice input cues", () => {
  beforeEach(() => {
    audio.players.length = 0;
  });

  it("never takes the audio session from media the user is playing", async () => {
    const media = acquireAudioSession("playback");
    await activateAudioSession(media);
    playVoiceInputCue("error");

    expect(audio.players).toEqual([]);
    await releaseAudioSession(media);
  });

  it("plays a cue in an idle session and hands the session back when it ends", async () => {
    playVoiceInputCue("error");
    const [cue] = audio.players;
    await vi.waitFor(() => expect(cue?.play).toHaveBeenCalled());
    audio.setSessionOwner.mockClear();
    cue?.finish();

    await vi.waitFor(() => expect(cue?.release).toHaveBeenCalled());
    expect(audio.setSessionOwner).toHaveBeenLastCalledWith(false);
  });

  it("silences the start cue before its recording lets the session go", async () => {
    const recording = await startRecording();
    void playVoiceInputCueInRecording("start", recording);
    const [start] = audio.players;
    expect(start?.play).toHaveBeenCalled();

    const ending = playVoiceInputCueInRecording("stop", recording);
    expect(start?.pause).toHaveBeenCalledWith(false);
    const stop = audio.players[1];
    expect(stop?.play).toHaveBeenCalled();
    stop?.finish();
    await ending;
    await releaseAudioSession(recording);

    expect(audio.players).toHaveLength(2);
  });

  it("plays nothing in a recording session that was already released", async () => {
    const recording = await startRecording();
    await releaseAudioSession(recording);
    await playVoiceInputCueInRecording("stop", recording);

    expect(audio.players).toEqual([]);
  });
});
