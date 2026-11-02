import type { VoiceInputCue } from "@supaterm/client-runtime/voice-input";
import { createAudioPlayer, type AudioPlayer } from "expo-audio";

import { createAudioPlaybackSession } from "../../lib/audioSession";

/** Renders of the web cues: apps/web/scripts/render-voice-input-cues.ts. */
const CUE_SOURCES: Record<VoiceInputCue, number> = {
  start: require("../../../assets/sounds/voice-input-start.wav"),
  stop: require("../../../assets/sounds/voice-input-stop.wav"),
  discard: require("../../../assets/sounds/voice-input-discard.wav"),
  error: require("../../../assets/sounds/voice-input-error.wav"),
};

type CuePlayer = {
  readonly player: AudioPlayer;
  readonly playback: ReturnType<typeof createAudioPlaybackSession>;
};

const cuePlayers = new Map<VoiceInputCue, CuePlayer>();

function cuePlayer(cue: VoiceInputCue): CuePlayer {
  const existing = cuePlayers.get(cue);
  if (existing) return existing;
  const player = createAudioPlayer(CUE_SOURCES[cue]);
  const playback = createAudioPlaybackSession(player);
  player.addListener("playbackStatusUpdate", (status) => {
    if ((status.didJustFinish || status.error) && playback.requested) playback.pause();
  });
  const created = { player, playback };
  cuePlayers.set(cue, created);
  return created;
}

/**
 * A recording that is running owns the audio session, so its start cue plays in that
 * session. Every other cue waits until no recording holds the session, then takes it.
 */
export function playVoiceInputCue(cue: VoiceInputCue, { duringRecording = false } = {}): void {
  const { player, playback } = cuePlayer(cue);
  const rewind = () => player.seekTo(0).catch(() => {});
  if (duringRecording) {
    void rewind().then(() => player.play());
    return;
  }
  void playback.play(rewind).catch(() => {});
}
