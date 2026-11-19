import type { VoiceInputPhase } from "@supaterm/client-runtime/voice-input";

type VoiceInputActivity = "idle" | "recording" | "transcribing";

const sessions = new Map<object, Exclude<VoiceInputActivity, "idle">>();
const listeners = new Set<() => void>();
let activity: VoiceInputActivity = "idle";

export function readVoiceInputActivity() {
  return activity;
}

export function subscribeVoiceInputActivity(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function publishVoiceInputActivity(owner: object, phase: VoiceInputPhase) {
  if (phase === "recording" || phase === "transcribing") sessions.set(owner, phase);
  else sessions.delete(owner);

  const active = [...sessions.values()];
  const next = active.includes("recording") ? "recording" : (active[0] ?? "idle");
  if (next === activity) return;
  activity = next;
  for (const listener of listeners) listener();
}
