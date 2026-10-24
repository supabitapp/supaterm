import {
  composerRecordingConsumer,
  createRecordingConsumers,
  createSavedRecordingRunner,
  type VoiceDraftSnapshot,
  type VoiceTranscriptEdit,
} from "@supaterm/client-runtime/voice-input";

import { readDictationAvailability } from "../state/dictation";
import { browserThreadOutboxStorage } from "../state/threadOutboxStorage";
import { webRecordings } from "./pendingClips";
import { transcribeDictationClip } from "./transcribeClip";

export const recordingConsumers = createRecordingConsumers();

export const webRecordingRunner = createSavedRecordingRunner({
  recordings: webRecordings,
  consumers: recordingConsumers,
  availability: readDictationAvailability,
  transcribe: (recording, blob, signal) =>
    transcribeDictationClip({
      requestId: recording.id,
      environmentId: recording.environmentId,
      sourceId: recording.sourceId,
      blob,
      mimeType: recording.mimeType,
      durationMs: recording.durationMs,
      locale: recording.locale,
      signal,
    }),
  withLock: (id, run) => browserThreadOutboxStorage.withLock(`dictation:${id}`, run),
});

export function registerDictationComposer(
  ownerKey: string,
  target: {
    readonly readDraft: () => VoiceDraftSnapshot | null;
    readonly commitDraft: (
      text: string,
      selection: { readonly start: number; readonly end: number },
      edit: VoiceTranscriptEdit,
    ) => boolean;
  },
): () => void {
  return recordingConsumers.register(ownerKey, composerRecordingConsumer(target));
}
