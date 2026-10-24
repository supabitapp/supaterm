import type { DictationClipFailure } from "@supaterm/client-runtime/state/dictation-failure";
import { threadOutboxRetryDelayMs } from "@supaterm/client-runtime/thread-outbox";
import type { VoiceDraftSnapshot } from "@supaterm/client-runtime/voice-input";
import { DictationSourceId, EnvironmentId } from "@supaterm/contracts";
import * as Schema from "effect/Schema";

export const StoredPendingVoiceRecording = Schema.Struct({
  id: Schema.String,
  ownerKey: Schema.String,
  environmentId: EnvironmentId,
  sourceId: DictationSourceId,
  fileName: Schema.String,
  mimeType: Schema.String,
  durationMs: Schema.Number,
  locale: Schema.String,
  createdAt: Schema.String,
  status: Schema.Literals(["waiting", "transcribing", "ready", "failed"]),
  transcript: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
  attempts: Schema.Number,
  retryAt: Schema.Number,
});
export type StoredPendingVoiceRecording = typeof StoredPendingVoiceRecording.Type;

export interface PendingVoiceRecording extends StoredPendingVoiceRecording {
  /** Kept in memory only: a recording restored after relaunch always waits for Insert. */
  readonly capturedDraft: VoiceDraftSnapshot | null;
}

export type PendingVoiceRecordingPatch = Partial<
  Pick<PendingVoiceRecording, "status" | "transcript" | "error" | "attempts" | "retryAt">
>;

export function restoredPendingVoiceRecording(
  stored: StoredPendingVoiceRecording,
): PendingVoiceRecording {
  return {
    ...stored,
    status: stored.status === "transcribing" ? "waiting" : stored.status,
    capturedDraft: null,
  };
}

export function pendingVoiceRecordingAfterFailure(
  recording: Pick<PendingVoiceRecording, "attempts">,
  failure: Pick<DictationClipFailure, "kind" | "message">,
  now: number,
): PendingVoiceRecordingPatch {
  switch (failure.kind) {
    case "cancelled":
      return { status: "waiting" };
    case "transient": {
      const attempts = recording.attempts + 1;
      return {
        status: "waiting",
        error: failure.message,
        attempts,
        retryAt: now + threadOutboxRetryDelayMs(attempts),
      };
    }
    case "empty":
    case "terminal":
      return { status: "failed", error: failure.message };
  }
}

export const RETRY_PENDING_VOICE_RECORDING: PendingVoiceRecordingPatch = {
  status: "waiting",
  error: null,
  retryAt: 0,
};

export function planPendingVoiceRecordingRuns(input: {
  readonly recordings: ReadonlyArray<PendingVoiceRecording>;
  readonly reachable: ReadonlySet<EnvironmentId>;
  readonly isRunning: (id: string) => boolean;
  readonly now: number;
}): { readonly due: ReadonlyArray<string>; readonly nextRetryAt: number | null } {
  const due: string[] = [];
  let nextRetryAt: number | null = null;
  for (const recording of input.recordings) {
    if (
      recording.status !== "waiting" ||
      !input.reachable.has(recording.environmentId) ||
      input.isRunning(recording.id)
    ) {
      continue;
    }
    if (recording.retryAt > input.now) {
      nextRetryAt = Math.min(nextRetryAt ?? recording.retryAt, recording.retryAt);
      continue;
    }
    due.push(recording.id);
  }
  return { due, nextRetryAt };
}

export function pendingVoiceRecordingStatus(
  recording: Pick<PendingVoiceRecording, "status" | "error">,
  reachable: boolean,
): string {
  switch (recording.status) {
    case "transcribing":
      return "Transcribing…";
    case "ready":
      return "Transcript ready";
    case "failed":
      return recording.error ?? "Could not transcribe this recording.";
    case "waiting":
      if (!reachable) return "Saved — transcribes when connected";
      return recording.error ?? "Waiting to transcribe";
  }
}

export function pendingVoiceRecordingRetry(
  recording: Pick<PendingVoiceRecording, "status">,
  reachable: boolean,
): "enabled" | "disabled" | null {
  if (recording.status === "failed") return "enabled";
  if (recording.status !== "waiting") return null;
  return reachable ? "enabled" : "disabled";
}

export function formatVoiceRecordingDuration(durationMs: number): string {
  const seconds = Math.max(1, Math.round(durationMs / 1_000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
