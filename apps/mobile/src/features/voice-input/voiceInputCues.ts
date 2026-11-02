import type { VoiceInputCue } from "@supaterm/client-runtime/voice-input";
import { createAudioPlayer, type AudioPlayer } from "expo-audio";
import { AppState } from "react-native";

import {
  disposeAudioPlayer,
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
 * Plays only inside the session a recording holds: taking a session of its own would
 * interrupt other audio. Silences the recording's earlier cue first; a null cue only does
 * that. Never rejects, so a cue cannot hold up releasing the recording.
 */
export async function playVoiceInputCue(
  cue: VoiceInputCue | null,
  recording: AudioSessionToken,
): Promise<void> {
  let player: AudioPlayer | null = null;
  try {
    if (recordingCue) pauseAudioPlayer(recordingCue);
    recordingCue = null;
    if (!cue || AppState.currentState !== "active" || !isAudioSessionOwner(recording)) return;
    player = createAudioPlayer(CUE_SOURCES[cue]);
    recordingCue = player;
    const finished = untilFinished(player);
    player.play();
    await finished;
  } catch {
  } finally {
    if (player) {
      if (recordingCue === player) recordingCue = null;
      disposeAudioPlayer(player);
    }
  }
}
