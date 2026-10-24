import {
  VoiceTranscriptionError,
  type VoiceTranscriber,
} from "@supaterm/client-runtime/voice-input";
import type { EnvironmentId, ProviderInstanceId } from "@supaterm/contracts";

import { parkPendingClip } from "./pendingClips";
import { readRecording, releaseRecording } from "./webVoiceRecorder";

export function createServerVoiceTranscriber(target: {
  readonly environmentId: EnvironmentId;
  readonly threadInstanceId: ProviderInstanceId | null;
}): VoiceTranscriber {
  return {
    prepare: async () => ({
      locale: navigator.language || "en-US",
      transcribe: async (uri, { signal, capturedDraft }) => {
        if (signal.aborted)
          throw new VoiceTranscriptionError("cancelled", "Transcription was cancelled.");
        const recording = readRecording(uri);
        if (!recording || !capturedDraft) {
          throw new VoiceTranscriptionError("transcription-failed", "The recording is missing.");
        }
        await parkPendingClip({
          ownerKey: capturedDraft.ownerKey,
          environmentId: target.environmentId,
          threadInstanceId: target.threadInstanceId,
          blob: recording.blob,
          mimeType: recording.mimeType,
          durationMs: recording.durationMs,
          locale: navigator.language || null,
          capturedDraft,
        });
        releaseRecording(uri);
        throw new VoiceTranscriptionError("deferred", "The recording was saved for transcription.");
      },
    }),
  };
}
