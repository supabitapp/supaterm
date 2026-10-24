import { resolveAssetUrl } from "@supaterm/client-runtime/state/assets";
import {
  clampFileAttachmentUploadBytes,
  deletePendingAttachmentUpload,
  runAttachmentUploadCycle,
} from "@supaterm/client-runtime/state/attachments";
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
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { File, UploadType } from "expo-file-system";

import { appAtomRegistry } from "../../state/atom-registry";
import { attachmentEnvironment } from "../../state/attachments";
import { dictationEnvironment } from "../../state/dictation";
import { environmentServerConfigsAtom } from "../../state/server";
import { environmentSession } from "../../state/session";

const decodeUpload = Schema.decodeUnknownSync(AttachmentCreateUploadUrlInput);
const UPLOAD_TIMEOUT_MS = 120_000;

function cancelled(): DictationClipFailure {
  return new DictationClipFailure("cancelled", "Transcription was cancelled.");
}

function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw cancelled();
}

function tooLarge(): DictationClipFailure {
  return new DictationClipFailure("terminal", "This recording is too large to transcribe.");
}

async function postRecording(
  file: File,
  url: string,
  mimeType: string,
  signal: AbortSignal,
): Promise<void> {
  const transfer = new AbortController();
  const abort = () => transfer.abort();
  signal.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, UPLOAD_TIMEOUT_MS);
  let status: number;
  try {
    const result = await file.upload(url, {
      httpMethod: "POST",
      uploadType: UploadType.BINARY_CONTENT,
      headers: { "Content-Type": mimeType },
      signal: transfer.signal,
    });
    status = result.status;
  } catch (error) {
    throwIfCancelled(signal);
    throw new DictationClipFailure("transient", "Recording upload disconnected.", {
      cause: error,
    });
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
  if (status >= 200 && status < 300) return;
  throw status >= 500 || status === 408 || status === 429
    ? new DictationClipFailure("transient", "Recording upload disconnected.")
    : new DictationClipFailure("terminal", `Recording upload failed (${status}).`);
}

/**
 * Uploads the recording as a pending attachment and asks the environment to transcribe it. The
 * server is idempotent by `requestId`, so a retry after a lost response returns the same text.
 */
export async function transcribeVoiceRecording(input: {
  readonly requestId: string;
  readonly environmentId: EnvironmentId;
  readonly sourceId: DictationSourceId;
  readonly uri: string;
  readonly extension: string;
  readonly mimeType: string;
  readonly durationMs: number;
  readonly locale: string | null;
  readonly signal: AbortSignal;
}): Promise<{ readonly text: string }> {
  const { environmentId, signal } = input;
  throwIfCancelled(signal);
  const config = appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId);
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
  const file = new File(input.uri);
  if (!file.exists) {
    throw new DictationClipFailure("terminal", "The recording is no longer available.");
  }
  const sizeBytes = file.size;
  if (
    sizeBytes > capability.maxClipBytes ||
    sizeBytes > clampFileAttachmentUploadBytes(maxUploadBytes)
  ) {
    throw tooLarge();
  }
  const source = resolveDictationSource({
    sources: config.dictation?.sources ?? [],
    settings: { enabled: true, source: input.sourceId },
  });
  if (source && !source.audioFormats.includes(input.extension)) {
    throw new DictationClipFailure(
      "terminal",
      "The transcription service can't read this recording format.",
    );
  }

  let transferError: unknown = null;
  const upload = await runAttachmentUploadCycle({
    registry: appAtomRegistry,
    createUploadUrl: attachmentEnvironment.createUploadUrl,
    remove: attachmentEnvironment.remove,
    environmentId,
    upload: decodeUpload({
      type: "file",
      name: `dictation.${input.extension}`,
      mimeType: input.mimeType,
      sizeBytes,
    }),
    resolveUploadUrl: (relativeUrl) => {
      const connection = appAtomRegistry.get(
        environmentSession.preparedConnectionValueAtom(environmentId),
      );
      return Option.isNone(connection)
        ? null
        : resolveAssetUrl(connection.value.httpBaseUrl, relativeUrl);
    },
    onMinted: () => (signal.aborted ? "cancel" : "continue"),
    transport: (url) => {
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal.addEventListener("abort", abort, { once: true });
      return {
        abort,
        done: postRecording(file, url, input.mimeType, controller.signal)
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
    if (upload.status === "cancelled") throw cancelled();
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
        appAtomRegistry,
        dictationEnvironment.transcribe,
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
    return { text: result.value.text };
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}
