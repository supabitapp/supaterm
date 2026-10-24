import {
  clampFileAttachmentUploadBytes,
  deletePendingAttachmentUpload,
  runAttachmentUploadCycle,
} from "@supaterm/client-runtime/state/attachments";
import { resolveAssetUrl } from "@supaterm/client-runtime/state/assets";
import {
  classifyDictationFailure,
  DictationClipFailure,
  dictationLanguage,
} from "@supaterm/client-runtime/state/dictation-failure";
import { runAtomCommand, squashAtomCommandFailure } from "@supaterm/client-runtime/state/runtime";
import {
  AttachmentCreateUploadUrlInput,
  DICTATION_MIN_DURATION_MS,
  DictationRequestId,
  resolveDictationSource,
  type DictationSourceId,
  type EnvironmentId,
} from "@supaterm/contracts";
import * as Schema from "effect/Schema";

import { appAtomRegistry } from "../rpc/atomRegistry";
import { attachmentEnvironment } from "../state/attachments";
import { dictationEnvironment } from "../state/dictation";
import { environmentServerConfigsAtom } from "../state/server";
import { readPreparedConnection } from "../state/session";
import { convertRecordingToWav } from "./audioConversion";

const decodeUpload = Schema.decodeUnknownSync(AttachmentCreateUploadUrlInput);

export interface DictationClip {
  readonly blob: Blob;
  readonly mimeType: string;
  readonly durationMs: number;
  readonly locale: string | null;
}

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

function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new DictationClipFailure("cancelled", "Transcription was cancelled.");
}

async function postClip(url: string, clip: DictationClip, signal: AbortSignal): Promise<void> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      body: clip.blob,
      headers: { "Content-Type": clip.mimeType },
      signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]),
    });
  } catch (error) {
    throwIfCancelled(signal);
    throw new DictationClipFailure("transient", "Recording upload disconnected.", {
      cause: error,
    });
  }
  if (!response.ok) {
    throw response.status >= 500 || response.status === 408 || response.status === 429
      ? new DictationClipFailure("transient", "Recording upload disconnected.")
      : new DictationClipFailure("terminal", `Recording upload failed (${response.status}).`);
  }
}

export async function transcribeDictationClip(input: {
  readonly requestId: string;
  readonly environmentId: EnvironmentId;
  readonly sourceId: DictationSourceId;
  readonly clip: DictationClip;
  readonly signal: AbortSignal;
}): Promise<{ readonly text: string; readonly sourceId: DictationSourceId }> {
  const { environmentId, signal } = input;
  let clip = input.clip;
  throwIfCancelled(signal);
  const config = appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId);
  if (!config) throw new DictationClipFailure("transient", "Transcribes once connected.");
  const capability = config.environment.capabilities.dictation;
  const maxUploadBytes = config.environment.capabilities.fileAttachments?.maxUploadBytes;
  if (!capability || maxUploadBytes === undefined) {
    throw new DictationClipFailure("terminal", "This environment can't transcribe recordings.");
  }
  if (clip.durationMs < DICTATION_MIN_DURATION_MS) {
    throw new DictationClipFailure("empty", "This recording is too short to transcribe.");
  }

  if (clip.durationMs > capability.maxDurationMs + 1_000) {
    throw new DictationClipFailure("terminal", "This recording is longer than 5 minutes.");
  }
  if (
    clip.blob.size > capability.maxClipBytes ||
    clip.blob.size > clampFileAttachmentUploadBytes(maxUploadBytes)
  ) {
    throw new DictationClipFailure("terminal", "This recording is too large to transcribe.");
  }
  const source = resolveDictationSource({
    sources: config.dictation?.sources ?? [],
    settings: { enabled: true, source: input.sourceId },
  });
  const extension = dictationClipFileName(clip.mimeType).split(".").at(-1) ?? "";
  if (source && !source.audioFormats.includes(extension) && source.audioFormats.includes("wav")) {
    try {
      clip = { ...clip, blob: await convertRecordingToWav(clip.blob), mimeType: "audio/wav" };
    } catch (error) {
      throwIfCancelled(signal);
      throw new DictationClipFailure(
        "terminal",
        "This recording could not be converted for transcription.",
        {
          cause: error,
        },
      );
    }
    throwIfCancelled(signal);
    if (
      clip.blob.size > capability.maxClipBytes ||
      clip.blob.size > clampFileAttachmentUploadBytes(maxUploadBytes)
    ) {
      throw new DictationClipFailure("terminal", "This recording is too large to transcribe.");
    }
  }

  let transferError: unknown = null;
  const upload = await runAttachmentUploadCycle({
    registry: appAtomRegistry,
    createUploadUrl: attachmentEnvironment.createUploadUrl,
    remove: attachmentEnvironment.remove,
    environmentId,
    upload: decodeUpload({
      type: "file",
      name: dictationClipFileName(clip.mimeType),
      mimeType: clip.mimeType,
      sizeBytes: clip.blob.size,
    }),
    resolveUploadUrl: (relativeUrl) => {
      const connection = readPreparedConnection(environmentId);
      return connection ? resolveAssetUrl(connection.httpBaseUrl, relativeUrl) : null;
    },
    onMinted: () => (signal.aborted ? "cancel" : "continue"),
    transport: (url) => {
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal.addEventListener("abort", abort, { once: true });
      return {
        abort,
        done: postClip(url, clip, controller.signal)
          .catch((error: unknown) => {
            transferError = error;
            throw error;
          })
          .finally(() => signal.removeEventListener("abort", abort)),
      };
    },
  });
  if (upload.status !== "uploaded") {
    if (upload.attachmentId !== null && upload.status === "failed") {
      deletePendingAttachmentUpload({
        registry: appAtomRegistry,
        remove: attachmentEnvironment.remove,
        environmentId,
        attachmentId: upload.attachmentId,
      });
    }
    throwIfCancelled(signal);
    if (upload.status === "cancelled") {
      throw new DictationClipFailure("cancelled", "Transcription was cancelled.");
    }
    if (upload.step === "resolve-url") {
      throw new DictationClipFailure("transient", "Transcribes once connected.");
    }
    throw classifyDictationFailure(transferError ?? upload.error);
  }

  if (signal.aborted) {
    deletePendingAttachmentUpload({
      registry: appAtomRegistry,
      remove: attachmentEnvironment.remove,
      environmentId,
      attachmentId: upload.attachmentId,
    });
    throwIfCancelled(signal);
  }
  const language = dictationLanguage(clip.locale);
  let onAbort: () => void = () => undefined;
  const cancelled = new Promise<never>((_, reject) => {
    onAbort = () => reject(new DictationClipFailure("cancelled", "Transcription was cancelled."));
  });
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    const result = await Promise.race([
      runAtomCommand(
        appAtomRegistry,
        dictationEnvironment.transcribe,
        {
          environmentId,
          input: {
            requestId: DictationRequestId.make(input.requestId),
            attachmentId: upload.attachmentId,
            sourceId: input.sourceId,
            durationMs: Math.min(Math.round(clip.durationMs), capability.maxDurationMs),
            ...(language ? { language } : {}),
          },
        },
        { reportFailure: false },
      ),
      cancelled,
    ]);
    if (result._tag === "Failure") throw classifyDictationFailure(squashAtomCommandFailure(result));
    if (result.value.text.trim().length === 0) {
      throw new DictationClipFailure("empty", "No speech was detected.");
    }
    return result.value;
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}
