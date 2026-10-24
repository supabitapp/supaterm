import type { DictationHiddenReason } from "@supaterm/client-runtime/state/dictation";
import { classifyDictationFailure } from "@supaterm/client-runtime/state/dictation-failure";
import { resolveParkedInsertion } from "@supaterm/client-runtime/voice-input";

import { readDictationAvailability } from "../../state/dictation";
import { pendingVoiceRecordingAfterFailure } from "./pendingVoiceRecordingModel";
import {
  discardPendingVoiceRecording,
  pendingVoiceRecordingUri,
  readPendingVoiceRecording,
  registerPendingVoiceRecordingWork,
  updatePendingVoiceRecording,
} from "./pendingVoiceRecordings";
import { transcribeVoiceRecording } from "./transcribeVoiceRecording";
import { readVoiceComposerTarget } from "./voiceComposerTargets";

const UNAVAILABLE_COPY = {
  unsupported: "This environment can't transcribe recordings.",
  forbidden: "This connection can't use dictation.",
  disabled: "Dictation is turned off for this environment.",
  "no-source": "No transcription model is available.",
  "no-capture": "No transcription model is available.",
} satisfies Record<Exclude<DictationHiddenReason, "unknown">, string>;

const running = new Set<string>();

export function isPendingVoiceRecordingRunning(id: string): boolean {
  return running.has(id);
}

/** Never sends: a transcript lands in its draft only when that draft is unchanged. */
export async function transcribePendingVoiceRecording(id: string): Promise<void> {
  const recording = readPendingVoiceRecording(id);
  if (running.has(id) || recording?.status !== "waiting") return;
  const availability = readDictationAvailability(recording.environmentId);
  if (availability.kind === "hidden") {
    if (availability.reason !== "unknown") {
      updatePendingVoiceRecording(id, {
        status: "failed",
        error: UNAVAILABLE_COPY[availability.reason],
      });
    }
    return;
  }
  running.add(id);
  const controller = new AbortController();
  const unregister = registerPendingVoiceRecordingWork(id, controller);
  try {
    updatePendingVoiceRecording(id, { status: "transcribing", error: null });
    const outcome = await transcribeVoiceRecording({
      requestId: recording.id,
      environmentId: recording.environmentId,
      sourceId: recording.sourceId,
      uri: pendingVoiceRecordingUri(recording),
      extension: recording.fileName.split(".").at(-1) ?? "",
      mimeType: recording.mimeType,
      durationMs: recording.durationMs,
      locale: recording.locale,
      signal: controller.signal,
    }).then(
      (result) => ({ ok: true as const, text: result.text }),
      (error: unknown) => ({ ok: false as const, failure: classifyDictationFailure(error) }),
    );
    const current = readPendingVoiceRecording(id);
    if (!current) return;
    if (!outcome.ok) {
      updatePendingVoiceRecording(
        id,
        pendingVoiceRecordingAfterFailure(current, outcome.failure, Date.now()),
      );
      return;
    }
    const target = readVoiceComposerTarget(current.ownerKey);
    const insertion = resolveParkedInsertion({
      captured: current.capturedDraft,
      current: target?.readDraft() ?? null,
      transcript: outcome.text,
      locale: current.locale,
    });
    if (insertion.kind === "commit" && target?.commitDraft(insertion.text, insertion.selection)) {
      discardPendingVoiceRecording(id);
      return;
    }
    updatePendingVoiceRecording(
      id,
      insertion.kind === "empty"
        ? { status: "failed", error: "No speech was detected." }
        : { status: "ready", transcript: outcome.text.trim(), error: null },
    );
  } finally {
    unregister();
    running.delete(id);
  }
}
