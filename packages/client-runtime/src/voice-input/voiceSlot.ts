import { resolveTranscriptCommit } from "./controller.ts";

export const VOICE_SLOT = "\uE000";

function clamp(text: string, offset: number): number {
  return Math.max(0, Math.min(text.length, offset));
}

export function placeVoiceSlot(
  text: string,
  selection: { readonly start: number; readonly end: number },
): string {
  const start = clamp(text, Math.min(selection.start, selection.end));
  const end = clamp(text, Math.max(selection.start, selection.end));
  return `${text.slice(0, start).replaceAll(VOICE_SLOT, "")}${VOICE_SLOT}${text
    .slice(end)
    .replaceAll(VOICE_SLOT, "")}`;
}

export function extractVoiceSlot(text: string): {
  readonly text: string;
  readonly insertAt: number;
} {
  const index = text.indexOf(VOICE_SLOT);
  if (index < 0) return { text, insertAt: text.length };
  return {
    text: `${text.slice(0, index)}${text.slice(index + VOICE_SLOT.length).replaceAll(VOICE_SLOT, "")}`,
    insertAt: index,
  };
}

export function spliceTranscriptAt(
  text: string,
  insertAt: number,
  transcript: string,
  locale: string,
): string | null {
  const at = clamp(text, insertAt);
  const snapshot = { ownerKey: "", text, selection: { start: at, end: at }, revision: 0 };
  const result = resolveTranscriptCommit(snapshot, snapshot, transcript, locale);
  return result.kind === "commit" ? result.text : null;
}
