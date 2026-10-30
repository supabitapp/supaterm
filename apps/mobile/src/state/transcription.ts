import { resolveAssetUrl } from "@supaterm/client-runtime/state/assets";
import {
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@supaterm/client-runtime/state/runtime";
import {
  createServerVoiceTranscriber,
  createTranscriptionEnvironmentAtoms,
  uploadVoiceRecording,
  VoiceUploadError,
  type VoiceUploadResponse,
} from "@supaterm/client-runtime/state/transcription";
import { shouldRetryThreadOutboxDelivery } from "@supaterm/client-runtime/thread-outbox";
import type { VoiceTranscriber } from "@supaterm/client-runtime/voice-input";
import {
  TranscriptionError,
  type EnvironmentId,
  type ProjectId,
  type ThreadId,
  type TranscriptionPrepareUploadInput,
  type TranscriptionPrepareUploadResult,
  type TranscriptionUploadResult,
} from "@supaterm/contracts";
import * as Option from "effect/Option";

import { connectionAtomRuntime } from "../connection/runtime";
import { loadExpoFileSystem } from "../lib/expoFileSystem";
import { readVoiceRecording } from "../lib/voiceRecordingWav";
import { appAtomRegistry } from "./atom-registry";
import { environmentSession } from "./session";

export const transcriptionEnvironment = createTranscriptionEnvironmentAtoms(connectionAtomRuntime);

// Long enough for five minutes of audio to upload and transcribe on a slow link. Running out
// only drops this wait: the server keeps working, and posting again joins it.
const UPLOAD_TIMEOUT_MS = 120_000;

function disconnected(cause: unknown): VoiceUploadError {
  return new VoiceUploadError(
    "disconnected",
    "The recording couldn't reach the environment.",
    true,
    { cause },
  );
}

async function prepareUpload(
  environmentId: EnvironmentId,
  request: TranscriptionPrepareUploadInput,
): Promise<TranscriptionPrepareUploadResult> {
  const result = await runAtomCommand(
    appAtomRegistry,
    transcriptionEnvironment.prepareUpload,
    { environmentId, input: request },
    { reportFailure: false, reportDefect: false },
  );
  if (result._tag === "Success") return result.value;
  if (isAtomCommandInterrupted(result)) throw disconnected(result.cause);
  const error = squashAtomCommandFailure(result);
  if (error instanceof TranscriptionError) {
    throw new VoiceUploadError(error.reason, error.message, error.reason === "rateLimited", {
      cause: error,
    });
  }
  if (shouldRetryThreadOutboxDelivery(error)) throw disconnected(error);
  throw new VoiceUploadError(
    undefined,
    error instanceof Error ? error.message : "Transcription failed.",
    false,
    { cause: error },
  );
}

async function postRecording(
  environmentId: EnvironmentId,
  uri: string,
  relativeUrl: string,
  signal: AbortSignal,
): Promise<VoiceUploadResponse> {
  const { File, UploadType } = await loadExpoFileSystem();
  const connection = appAtomRegistry.get(
    environmentSession.preparedConnectionValueAtom(environmentId),
  );
  const url = Option.isSome(connection)
    ? resolveAssetUrl(connection.value.httpBaseUrl, relativeUrl)
    : null;
  if (url === null) throw new Error("The environment is not connected.");
  const transfer = new AbortController();
  const abort = () => transfer.abort();
  signal.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, UPLOAD_TIMEOUT_MS);
  try {
    const response = await new File(uri).upload(url, {
      httpMethod: "POST",
      uploadType: UploadType.BINARY_CONTENT,
      headers: { "Content-Type": "audio/wav" },
      signal: transfer.signal,
    });
    let body: unknown = null;
    try {
      body = JSON.parse(response.body);
    } catch {}
    return { status: response.status, body };
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
}

/** Uploads a WAV for the environment to transcribe, and to send when `submit` is set. */
export async function uploadEnvironmentVoiceRecording(input: {
  readonly environmentId: EnvironmentId;
  readonly uri: string;
  readonly request: TranscriptionPrepareUploadInput;
  readonly signal?: AbortSignal;
}): Promise<TranscriptionUploadResult> {
  const { environmentId, uri } = input;
  try {
    return await uploadVoiceRecording({
      request: input.request,
      prepare: (request) => prepareUpload(environmentId, request),
      post: (relativeUrl, signal) => postRecording(environmentId, uri, relativeUrl, signal),
      cancel: (uploadId) =>
        runAtomCommand(
          appAtomRegistry,
          transcriptionEnvironment.cancelUpload,
          { environmentId, input: { uploadId } },
          { reportFailure: false, reportDefect: false },
        ),
      ...(input.signal ? { signal: input.signal } : {}),
    });
  } catch (error) {
    if (error instanceof VoiceUploadError && error.reason === "unsupportedLanguage") {
      throw new VoiceUploadError(
        error.reason,
        `${error.message} Choose a voice language in Settings.`,
        false,
        { cause: error },
      );
    }
    throw error;
  }
}

/** Transcribes for review: the environment returns the text and sends nothing. */
export function createEnvironmentVoiceTranscriber(input: {
  readonly environmentId: EnvironmentId;
  readonly language: string;
  readonly context?: { readonly threadId?: ThreadId; readonly projectId?: ProjectId };
}): VoiceTranscriber {
  return createServerVoiceTranscriber({
    locale: input.language,
    transcribe: async (uri, signal) => {
      const { sizeBytes } = await readVoiceRecording(uri);
      return uploadEnvironmentVoiceRecording({
        environmentId: input.environmentId,
        uri,
        request: {
          sizeBytes,
          language: input.language,
          ...(input.context ? { context: input.context } : {}),
        },
        signal,
      });
    },
  });
}
