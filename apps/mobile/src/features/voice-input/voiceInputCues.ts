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
 * The start cue plays in the session the new recording holds. Every other cue takes a
 * playback session, which a recording must release first.
 */
export function playVoiceInputCue(cue: VoiceInputCue): void {
  const { player, playback } = cuePlayer(cue);
  const rewind = () => player.seekTo(0).catch(() => {});
  if (cue === "start") {
    void rewind().then(() => player.play());
    return;
  }
  void playback.play(rewind).catch(() => {});
}
