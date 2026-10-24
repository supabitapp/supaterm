import {
  AttachmentCreateUploadUrlInput,
  DICTATION_MIN_DURATION_MS,
  DictationRequestId,
  resolveDictationSource,
  type DictationSourceId,
  type DictationTranscribeInput,
  type DictationTranscribeResult,
  type EnvironmentId,
  type ServerConfig,
} from "@supaterm/contracts";
import * as Schema from "effect/Schema";
import type { AtomRegistry } from "effect/reactivity";

import {
  clampFileAttachmentUploadBytes,
  deletePendingAttachmentUpload,
  runAttachmentUploadCycle,
  type AttachmentCreateUploadUrlCommand,
  type AttachmentRemoveCommand,
} from "./attachments.ts";
import {
  classifyDictationFailure,
  DictationClipFailure,
  dictationLanguage,
} from "./dictationFailure.ts";
import { runAtomCommand, squashAtomCommandFailure, type AtomCommand } from "./runtime.ts";

const decodeUpload = Schema.decodeUnknownSync(AttachmentCreateUploadUrlInput);

export type DictationTranscribeCommand<E> = AtomCommand<
  { readonly environmentId: EnvironmentId; readonly input: DictationTranscribeInput },
  DictationTranscribeResult,
  E
>;

export interface DictationRecordingAudio {
  readonly fileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
}

function cancelled(): DictationClipFailure {
  return new DictationClipFailure("cancelled", "Transcription was cancelled.");
}

function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw cancelled();
}

export function dictationFileExtension(fileName: string): string {
  return fileName.split(".").at(-1)?.toLowerCase() ?? "";
}

/**
 * Uploads a recording as a pending attachment, then asks the environment to transcribe it. The
 * server is idempotent by `requestId`, so a retry after a lost response returns the same text.
 * `send` only moves the bytes; everything else is shared by every client.
 */
export async function transcribeDictationRecording<UE, RE, TE>(input: {
  readonly registry: AtomRegistry.AtomRegistry;
  readonly config: ServerConfig | null;
  readonly createUploadUrl: AttachmentCreateUploadUrlCommand<UE>;
  readonly removeUpload: AttachmentRemoveCommand<RE>;
  readonly transcribe: DictationTranscribeCommand<TE>;
  readonly resolveUploadUrl: (relativeUrl: string) => string | null;
  readonly send: (url: string, signal: AbortSignal) => Promise<number>;
  readonly requestId: string;
  readonly environmentId: EnvironmentId;
  readonly sourceId: DictationSourceId;
  readonly audio: DictationRecordingAudio;
  readonly durationMs: number;
  readonly locale: string | null;
  readonly signal: AbortSignal;
}): Promise<string> {
  const { config, environmentId, signal } = input;
  throwIfCancelled(signal);
  if (!config) throw new DictationClipFailure("transient", "Transcribes once connected.");
  const capability = config.environment.capabilities.dictation;
  const maxUploadBytes = config.environment.capabilities.fileAttachments?.maxUploadBytes;
  if (!capability || maxUploadBytes === undefined) {
    throw new DictationClipFailure("terminal", "This environment can't transcribe recordings.");
  }
  if (input.durationMs < DICTATION_MIN_DURATION_MS) {
    throw new DictationClipFailure("empty", "This recording is too short to transcribe.");
  }
  if (input.durationMs > capability.maxDurationMs + 1_000) {
    throw new DictationClipFailure("terminal", "This recording is longer than 5 minutes.");
  }
  if (
    input.audio.sizeBytes > capability.maxClipBytes ||
    input.audio.sizeBytes > clampFileAttachmentUploadBytes(maxUploadBytes)
  ) {
    throw new DictationClipFailure("terminal", "This recording is too large to transcribe.");
  }
  const source = resolveDictationSource({
    sources: config.dictation?.sources ?? [],
    settings: { enabled: true, source: input.sourceId },
  });
  if (source && !source.audioFormats.includes(dictationFileExtension(input.audio.fileName))) {
    throw new DictationClipFailure(
      "terminal",
      "The transcription service can't read this recording format.",
    );
  }

  let transferError: unknown = null;
  const upload = await runAttachmentUploadCycle({
    registry: input.registry,
    createUploadUrl: input.createUploadUrl,
    remove: input.removeUpload,
    environmentId,
    upload: decodeUpload({
      type: "file",
      name: input.audio.fileName,
      mimeType: input.audio.mimeType,
      sizeBytes: input.audio.sizeBytes,
    }),
    resolveUploadUrl: input.resolveUploadUrl,
    onMinted: () => (signal.aborted ? "cancel" : "continue"),
    transport: (url) => {
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal.addEventListener("abort", abort, { once: true });
      return {
        abort,
        done: sendRecording(input.send, url, controller.signal, signal)
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
        registry: input.registry,
        remove: input.removeUpload,
        environmentId,
        attachmentId: upload.attachmentId,
      });
    }
    throwIfCancelled(signal);
    if (upload.status === "cancelled") throw cancelled();
    if (upload.step === "resolve-url") {
      throw new DictationClipFailure("transient", "Transcribes once connected.");
    }
    throw classifyDictationFailure(transferError ?? upload.error);
  }
  if (signal.aborted) {
    deletePendingAttachmentUpload({
      registry: input.registry,
      remove: input.removeUpload,
      environmentId,
      attachmentId: upload.attachmentId,
    });
    throw cancelled();
  }

  const language = dictationLanguage(input.locale);
  let onAbort: () => void = () => undefined;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(cancelled());
  });
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    const result = await Promise.race([
      runAtomCommand(
        input.registry,
        input.transcribe,
        {
          environmentId,
          input: {
            requestId: DictationRequestId.make(input.requestId),
            attachmentId: upload.attachmentId,
            sourceId: input.sourceId,
            durationMs: Math.min(Math.round(input.durationMs), capability.maxDurationMs),
            ...(language ? { language } : {}),
          },
        },
        { reportFailure: false },
      ),
      aborted,
    ]);
    if (result._tag === "Failure") throw classifyDictationFailure(squashAtomCommandFailure(result));
    if (result.value.text.trim().length === 0) {
      throw new DictationClipFailure("empty", "No speech was detected.");
    }
    return result.value.text;
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

async function sendRecording(
  send: (url: string, signal: AbortSignal) => Promise<number>,
  url: string,
  transferSignal: AbortSignal,
  signal: AbortSignal,
): Promise<void> {
  let status: number;
  try {
    status = await send(url, transferSignal);
  } catch (error) {
    throwIfCancelled(signal);
    throw new DictationClipFailure("transient", "Recording upload disconnected.", {
      cause: error,
    });
  }
  if (status >= 200 && status < 300) return;
  throw status >= 500 || status === 408 || status === 429
    ? new DictationClipFailure("transient", "Recording upload disconnected.")
    : new DictationClipFailure("terminal", `Recording upload failed (${status}).`);
}
