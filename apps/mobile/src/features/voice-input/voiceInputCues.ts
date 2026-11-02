import type { VoiceInputCue } from "@supaterm/client-runtime/voice-input";
import { createAudioPlayer, type AudioPlayer } from "expo-audio";
import { AppState } from "react-native";

import {
  createAudioPlaybackSession,
  disposeAudioPlayer,
  isAudioSessionIdle,
  isAudioSessionOwner,
  pauseAudioPlayer,
  type AudioSessionToken,
} from "../../lib/audioSession";

/** Renders of the web cues: apps/web/scripts/render-voice-input-cues.ts. */
const CUE_SOURCES: Record<VoiceInputCue, number> = {
  start: require("../../../assets/sounds/voice-input-start.wav"),
  stop: require("../../../assets/sounds/voice-input-stop.wav"),
  discard: require("../../../assets/sounds/voice-input-discard.wav"),
  error: require("../../../assets/sounds/voice-input-error.wav"),
};

// A cue loads and plays in under half a second; this bounds a player that never reports its end.
const CUE_LIMIT_MS = 1_000;

let recordingCue: AudioPlayer | null = null;

function untilFinished(player: AudioPlayer): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(limit);
      subscription.remove();
      resolve();
    };
    const limit = setTimeout(finish, CUE_LIMIT_MS);
    const subscription = player.addListener("playbackStatusUpdate", (status) => {
      if (status.didJustFinish || status.error) finish();
    });
  });
}

/**
 * Plays inside the session the recording holds, so a recording ending changes the session
 * once. Silences the cue the recording is already playing, which a null cue only does.
 */
export async function playVoiceInputCueInRecording(
  cue: VoiceInputCue | null,
  recording: AudioSessionToken,
): Promise<void> {
  if (recordingCue) pauseAudioPlayer(recordingCue);
  recordingCue = null;
  if (!cue || AppState.currentState !== "active" || !isAudioSessionOwner(recording)) return;
  const player = createAudioPlayer(CUE_SOURCES[cue]);
  recordingCue = player;
  const finished = untilFinished(player);
  player.play();
  await finished;
  if (recordingCue === player) recordingCue = null;
  disposeAudioPlayer(player);
}

/** Plays only while nothing holds the audio session, so a cue never pauses the user's media. */
export function playVoiceInputCue(cue: VoiceInputCue): void {
  if (AppState.currentState !== "active" || !isAudioSessionIdle()) return;
  const player = createAudioPlayer(CUE_SOURCES[cue]);
  const playback = createAudioPlaybackSession(player);
  const finished = untilFinished(player);
  void playback.play().catch(() => {});
  void finished.then(() => {
    playback.pause();
    disposeAudioPlayer(player);
  });
}
