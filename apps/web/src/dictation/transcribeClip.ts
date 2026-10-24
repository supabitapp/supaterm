import {
  clampFileAttachmentUploadBytes,
  deletePendingAttachmentUpload,
  runAttachmentUploadCycle,
} from "@supaterm/client-runtime/state/attachments";
import { resolveAssetUrl } from "@supaterm/client-runtime/state/assets";
import { runAtomCommand, squashAtomCommandFailure } from "@supaterm/client-runtime/state/runtime";
import { shouldRetryThreadOutboxDelivery } from "@supaterm/client-runtime/thread-outbox";
import {
  AttachmentCreateUploadUrlInput,
  DICTATION_MIN_DURATION_MS,
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

export type DictationFailureKind = "transient" | "terminal" | "empty" | "cancelled";

export class DictationClipFailure extends Error {
  readonly kind: DictationFailureKind;

  constructor(kind: DictationFailureKind, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DictationClipFailure";
    this.kind = kind;
  }
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

export function dictationLanguage(locale: string | null): string | null {
  const language = locale?.split(/[-_]/)[0]?.trim().toLowerCase();
  return language && /^[a-z]{2,3}$/.test(language) ? language : null;
}

function failureTag(error: unknown): string | null {
  return typeof error === "object" && error !== null && "_tag" in error ? String(error._tag) : null;
}

function field(error: unknown, key: string): unknown {
  return typeof error === "object" && error !== null && key in error
    ? (error as Record<string, unknown>)[key]
    : undefined;
}

export function classifyDictationFailure(error: unknown): DictationClipFailure {
  if (error instanceof DictationClipFailure) return error;
  switch (failureTag(error)) {
    case "DictationUnavailableError":
      switch (field(error, "reason")) {
        case "disabled":
          return new DictationClipFailure(
            "terminal",
            "Dictation is turned off for this environment.",
          );
        case "endpoint-rejected":
          return new DictationClipFailure(
            "terminal",
            "The transcription service did not accept this request. The recording is saved.",
          );
        default:
          return new DictationClipFailure(
            "terminal",
            "This transcription model is no longer available. Choose another in Settings.",
          );
      }
    case "DictationAuthError":
      return new DictationClipFailure(
        "terminal",
        "Sign in to the transcription account again. The recording is saved.",
      );
    case "DictationRateLimitedError":
      return new DictationClipFailure(
        "transient",
        "Transcription limit reached. The recording is saved.",
      );
    case "DictationUpstreamError":
      return field(error, "category") === "bad-response"
        ? new DictationClipFailure(
            "terminal",
            "The transcription service sent an unexpected response.",
          )
        : new DictationClipFailure(
            "transient",
            "Couldn't reach the transcription service. The recording is saved.",
          );
    case "DictationClipError":
      switch (field(error, "problem")) {
        case "missing":
          return new DictationClipFailure("transient", "The recording upload expired.");
        case "too-short":
          return new DictationClipFailure("empty", "This recording is too short to transcribe.");
        case "too-long":
          return new DictationClipFailure("terminal", "This recording is longer than 5 minutes.");
        case "too-large":
          return new DictationClipFailure("terminal", "This recording is too large to transcribe.");
        default:
          return new DictationClipFailure(
            "terminal",
            "The transcription service can't read this recording format.",
          );
      }
    case "EnvironmentAuthorizationError":
      return new DictationClipFailure("terminal", "This connection can't use dictation.");
  }
  return shouldRetryThreadOutboxDelivery(error)
    ? new DictationClipFailure("transient", "Transcribes once connected.", { cause: error })
    : new DictationClipFailure("terminal", "Could not transcribe this recording.", {
        cause: error,
      });
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
