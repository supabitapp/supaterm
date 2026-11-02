import type { VoiceInputCue } from "@supaterm/client-runtime/voice-input";
import { play, type PlayOptions, type SoundName } from "cuelume";

/** Mobile plays WAV renders of these; rerun scripts/render-voice-input-cues.ts after a change. */
export const VOICE_INPUT_CUE_SOUNDS = {
  start: ["open", { theme: "bubble" }],
  stop: ["close", { theme: "bubble" }],
  discard: ["close", { theme: "bubble", emphasis: "subtle" }],
  error: ["error", { theme: "bubble" }],
} as const satisfies Record<VoiceInputCue, readonly [SoundName, PlayOptions]>;

export function playVoiceInputCue(cue: VoiceInputCue) {
  const [sound, options] = VOICE_INPUT_CUE_SOUNDS[cue];
  play(sound, options);
}
