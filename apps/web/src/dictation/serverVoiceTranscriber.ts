import {
  VoiceTranscriptionError,
  type VoiceTranscriber,
} from "@supaterm/client-runtime/voice-input";
import type { DictationSourceId, EnvironmentId } from "@supaterm/contracts";

import { randomUUID } from "../lib/utils";
import { webRecordings } from "./pendingClips";
import { readRecording, releaseRecording } from "./webVoiceRecorder";

/**
 * Saves every recording before anything is uploaded; the saved-recordings runner transcribes it
 * from storage, so a closed tab or a dropped connection never loses audio.
 */
export function createServerVoiceTranscriber(target: {
  readonly environmentId: EnvironmentId;
  readonly sourceId: DictationSourceId;
  /** Overrides the composer as owner, for a recording that becomes a queued message. */
  readonly ownerKey: () => string | null;
}): VoiceTranscriber {
  return {
    prepare: async () => {
      const locale = navigator.language || "en-US";
      return {
        locale,
        transcribe: async (uri, { signal, capturedDraft }) => {
          if (signal.aborted) {
            throw new VoiceTranscriptionError("cancelled", "Transcription was cancelled.");
          }
          const recording = readRecording(uri);
          if (!recording) {
            throw new VoiceTranscriptionError("transcription-failed", "The recording is missing.");
          }
          const saved = await webRecordings.save({
            id: randomUUID(),
            ownerKey: target.ownerKey() ?? capturedDraft.ownerKey,
            environmentId: target.environmentId,
            sourceId: target.sourceId,
            mimeType: recording.mimeType,
            durationMs: recording.durationMs,
            locale,
            capturedDraft,
            audio: recording.blob,
          });
          releaseRecording(uri);
          return { kind: "saved", recordingId: saved.id };
        },
      };
    },
  };
}
