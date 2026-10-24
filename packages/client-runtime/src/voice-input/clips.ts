import { resolveTranscriptCommit, type VoiceDraftSnapshot } from "./controller.ts";

export type ParkedInsertion =
  | {
      readonly kind: "commit";
      readonly text: string;
      readonly selection: { readonly start: number; readonly end: number };
    }
  | { readonly kind: "ready" }
  | { readonly kind: "empty" };

export function resolveParkedInsertion(input: {
  readonly captured: VoiceDraftSnapshot | null;
  readonly current: VoiceDraftSnapshot | null;
  readonly transcript: string;
  readonly locale: string;
}): ParkedInsertion {
  if (input.transcript.trim().length === 0) return { kind: "empty" };
  if (input.captured === null) return { kind: "ready" };
  const result = resolveTranscriptCommit(
    input.captured,
    input.current,
    input.transcript,
    input.locale,
  );
  return result.kind === "stale" ? { kind: "ready" } : result;
}
