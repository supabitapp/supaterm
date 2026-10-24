import { resolveAssetUrl } from "@supaterm/client-runtime/state/assets";
import { DictationClipFailure } from "@supaterm/client-runtime/state/dictation-failure";
import {
  dictationFileExtension,
  transcribeDictationRecording,
} from "@supaterm/client-runtime/state/dictation-upload";
import {
  createSavedRecordingRunner,
  type SavedRecordingEntry,
} from "@supaterm/client-runtime/voice-input";
import * as Option from "effect/Option";
import { File, UploadType } from "expo-file-system";

import { appAtomRegistry } from "../../state/atom-registry";
import { attachmentEnvironment } from "../../state/attachments";
import { dictationEnvironment, readDictationAvailability } from "../../state/dictation";
import { environmentServerConfigsAtom } from "../../state/server";
import { environmentSession } from "../../state/session";
import { savedVoiceRecordings } from "./pendingVoiceRecordings";
import { voiceRecordingConsumers } from "./voiceComposerTargets";

const UPLOAD_TIMEOUT_MS = 120_000;

async function uploadRecording(
  file: File,
  mimeType: string,
  url: string,
  signal: AbortSignal,
): Promise<number> {
  const transfer = new AbortController();
  const abort = () => transfer.abort();
  signal.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, UPLOAD_TIMEOUT_MS);
  try {
    const result = await file.upload(url, {
      httpMethod: "POST",
      uploadType: UploadType.BINARY_CONTENT,
      headers: { "Content-Type": mimeType },
      signal: transfer.signal,
    });
    return result.status;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
}

async function transcribeVoiceRecording(
  recording: SavedRecordingEntry,
  uri: string,
  signal: AbortSignal,
): Promise<string> {
  const { environmentId } = recording;
  const file = new File(uri);
  if (!file.exists) {
    throw new DictationClipFailure("terminal", "The recording is no longer available.");
  }
  return transcribeDictationRecording({
    registry: appAtomRegistry,
    config: appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId) ?? null,
    createUploadUrl: attachmentEnvironment.createUploadUrl,
    removeUpload: attachmentEnvironment.remove,
    transcribe: dictationEnvironment.transcribe,
    resolveUploadUrl: (relativeUrl) => {
      const connection = appAtomRegistry.get(
        environmentSession.preparedConnectionValueAtom(environmentId),
      );
      return Option.isNone(connection)
        ? null
        : resolveAssetUrl(connection.value.httpBaseUrl, relativeUrl);
    },
    send: (url, transferSignal) => uploadRecording(file, recording.mimeType, url, transferSignal),
    requestId: recording.id,
    environmentId,
    sourceId: recording.sourceId,
    audio: {
      fileName: `dictation.${dictationFileExtension(file.name)}`,
      mimeType: recording.mimeType,
      sizeBytes: file.size,
    },
    durationMs: recording.durationMs,
    locale: recording.locale,
    signal,
  });
}

export const voiceRecordingRunner = createSavedRecordingRunner({
  recordings: savedVoiceRecordings,
  consumers: voiceRecordingConsumers,
  availability: readDictationAvailability,
  transcribe: transcribeVoiceRecording,
});
