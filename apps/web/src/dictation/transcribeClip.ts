import { resolveAssetUrl } from "@supaterm/client-runtime/state/assets";
import { DictationClipFailure } from "@supaterm/client-runtime/state/dictation-failure";
import {
  dictationFileExtension,
  transcribeDictationRecording,
} from "@supaterm/client-runtime/state/dictation-upload";
import {
  resolveDictationSource,
  type DictationSourceId,
  type EnvironmentId,
} from "@supaterm/contracts";

import { appAtomRegistry } from "../rpc/atomRegistry";
import { attachmentEnvironment } from "../state/attachments";
import { dictationEnvironment } from "../state/dictation";
import { environmentServerConfigsAtom } from "../state/server";
import { readPreparedConnection } from "../state/session";
import { convertRecordingToWav } from "./audioConversion";

const UPLOAD_TIMEOUT_MS = 120_000;

export function dictationClipFileName(mimeType: string): string {
  const type = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (type === "audio/mp4" || type === "audio/x-m4a" || type === "audio/aac")
    return "dictation.m4a";
  if (type === "audio/ogg") return "dictation.ogg";
  if (type === "audio/wav" || type === "audio/x-wav" || type === "audio/wave") {
    return "dictation.wav";
  }
  return "dictation.webm";
}

/** Converts to WAV only when the chosen source can't read the browser's own format. */
async function audioForSource(
  config: ReturnType<typeof readConfig>,
  sourceId: DictationSourceId,
  blob: Blob,
  mimeType: string,
): Promise<{ readonly blob: Blob; readonly mimeType: string }> {
  const source = config
    ? resolveDictationSource({
        sources: config.dictation?.sources ?? [],
        settings: { enabled: true, source: sourceId },
      })
    : null;
  const extension = dictationFileExtension(dictationClipFileName(mimeType));
  if (!source || source.audioFormats.includes(extension) || !source.audioFormats.includes("wav")) {
    return { blob, mimeType };
  }
  try {
    return { blob: await convertRecordingToWav(blob), mimeType: "audio/wav" };
  } catch (error) {
    throw new DictationClipFailure(
      "terminal",
      "This recording could not be converted for transcription.",
      { cause: error },
    );
  }
}

function readConfig(environmentId: EnvironmentId) {
  return appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId) ?? null;
}

export async function transcribeDictationClip(input: {
  readonly requestId: string;
  readonly environmentId: EnvironmentId;
  readonly sourceId: DictationSourceId;
  readonly blob: Blob;
  readonly mimeType: string;
  readonly durationMs: number;
  readonly locale: string | null;
  readonly signal: AbortSignal;
}): Promise<string> {
  const config = readConfig(input.environmentId);
  const audio = await audioForSource(config, input.sourceId, input.blob, input.mimeType);
  return transcribeDictationRecording({
    registry: appAtomRegistry,
    config,
    createUploadUrl: attachmentEnvironment.createUploadUrl,
    removeUpload: attachmentEnvironment.remove,
    transcribe: dictationEnvironment.transcribe,
    resolveUploadUrl: (relativeUrl) => {
      const connection = readPreparedConnection(input.environmentId);
      return connection ? resolveAssetUrl(connection.httpBaseUrl, relativeUrl) : null;
    },
    send: async (url, signal) =>
      (
        await fetch(url, {
          method: "POST",
          body: audio.blob,
          headers: { "Content-Type": audio.mimeType },
          signal: AbortSignal.any([signal, AbortSignal.timeout(UPLOAD_TIMEOUT_MS)]),
        })
      ).status,
    requestId: input.requestId,
    environmentId: input.environmentId,
    sourceId: input.sourceId,
    audio: {
      fileName: dictationClipFileName(audio.mimeType),
      mimeType: audio.mimeType,
      sizeBytes: audio.blob.size,
    },
    durationMs: input.durationMs,
    locale: input.locale,
    signal: input.signal,
  });
}
