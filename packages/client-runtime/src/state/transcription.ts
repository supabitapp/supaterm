import {
  TranscriptionError,
  type TranscriptionErrorReason,
  type TranscriptionPrepareUploadInput,
  type TranscriptionPrepareUploadResult,
  TranscriptionUploadResult,
  WS_METHODS,
  type ProviderInstanceId,
  type ServerProvider,
} from "@supaterm/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  VoiceTranscriptionError,
  throwIfVoiceTranscriptionAborted,
  type VoiceTranscriber,
} from "../voice-input/transcription.ts";
import { createEnvironmentRpcCommand } from "./runtime.ts";

export function createTranscriptionEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    prepareUpload: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:transcription:prepare-upload",
      tag: WS_METHODS.transcriptionPrepareUpload,
    }),
    cancelUpload: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:transcription:cancel-upload",
      tag: WS_METHODS.transcriptionCancelUpload,
    }),
  };
}

export type VoiceTranscriptionSource =
  | { readonly status: "ready"; readonly provider: ServerProvider }
  | {
      readonly status: "unavailable";
      readonly provider: ServerProvider | null;
      readonly message: string;
    };

const providerName = (provider: ServerProvider) => provider.displayName ?? provider.instanceId;

/**
 * Mirrors the server, which transcribes only with the instance the setting names:
 * when it can't, nothing stands in for it, because that would charge another account.
 */
export function resolveVoiceTranscriptionSource(config: {
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly settings: { readonly transcriptionProviderInstanceId: ProviderInstanceId };
}): VoiceTranscriptionSource {
  const provider = config.providers.find(
    (candidate) => candidate.instanceId === config.settings.transcriptionProviderInstanceId,
  );
  if (!provider) {
    return {
      status: "unavailable",
      provider: null,
      message: "The voice transcription provider isn't set up on this environment.",
    };
  }
  if (!provider.enabled) {
    return {
      status: "unavailable",
      provider,
      message: `${providerName(provider)} is turned off on this environment.`,
    };
  }
  if (!provider.transcription) {
    return {
      status: "unavailable",
      provider,
      message: `${providerName(provider)} can't transcribe voice input.`,
    };
  }
  if (provider.transcription.status !== "ready") {
    return {
      status: "unavailable",
      provider,
      message: new TranscriptionError({
        reason: provider.transcription.reason ?? "unsupportedLogin",
      }).message,
    };
  }
  return { status: "ready", provider };
}

/** Transcription refused the recording, or the upload never reached the server. */
export class VoiceUploadError extends Error {
  readonly reason: TranscriptionErrorReason | "disconnected" | undefined;
  /** Sending the same upload again may succeed; otherwise the user has to act. */
  readonly retryable: boolean;

  constructor(
    reason: VoiceUploadError["reason"],
    message: string,
    retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "VoiceUploadError";
    this.reason = reason;
    this.retryable = retryable;
  }
}

const decodeResult = Schema.decodeUnknownSync(TranscriptionUploadResult);
const decodeError = Schema.decodeUnknownOption(TranscriptionError);

export type VoiceUploadResponse = { readonly status: number; readonly body: unknown };

function refusal(error: TranscriptionError): VoiceUploadError {
  return new VoiceUploadError(
    error.reason,
    error.retryAfterMs === undefined
      ? error.message
      : `${error.message} Try again in ${Math.ceil(error.retryAfterMs / 1000)} s.`,
    error.reason === "rateLimited",
  );
}

function uploadFailure(response: VoiceUploadResponse): VoiceUploadError {
  const error = Option.getOrUndefined(decodeError(response.body));
  return error
    ? refusal(error)
    : new VoiceUploadError(
        undefined,
        `The recording couldn't be uploaded (${response.status}).`,
        response.status >= 500,
      );
}

const unreachable = (cause: unknown) =>
  new VoiceUploadError("disconnected", "The recording couldn't reach the environment.", true, {
    cause,
  });

// A failed RPC surfaces as a tagged value, not necessarily a decoded class instance.
async function prepareUpload(
  prepare: () => Promise<TranscriptionPrepareUploadResult>,
): Promise<TranscriptionPrepareUploadResult> {
  try {
    return await prepare();
  } catch (error) {
    const refused = Option.getOrUndefined(decodeError(error));
    if (refused) throw refusal(refused);
    throw unreachable(error);
  }
}

/**
 * Prepares the upload, then posts the WAV. The upload id stays stable across both, so
 * a POST that may have reached the server is joined rather than paid for again, and a
 * URL that outlived its server is prepared once more.
 */
export async function uploadVoiceRecording(input: {
  readonly request: TranscriptionPrepareUploadInput;
  readonly prepare: (
    request: TranscriptionPrepareUploadInput,
  ) => Promise<TranscriptionPrepareUploadResult>;
  readonly post: (relativeUrl: string, signal: AbortSignal) => Promise<VoiceUploadResponse>;
  readonly cancel: (uploadId: string) => Promise<unknown>;
  readonly signal?: AbortSignal;
}): Promise<TranscriptionUploadResult> {
  const signal = input.signal ?? new AbortController().signal;
  for (let attempt = 0; ; attempt++) {
    throwIfVoiceTranscriptionAborted(signal);
    const prepared = await prepareUpload(() => input.prepare(input.request));
    let response: VoiceUploadResponse;
    try {
      response = await input.post(prepared.relativeUrl, signal);
    } catch (error) {
      if (signal.aborted) {
        await input.cancel(prepared.uploadId).catch(() => undefined);
        throwIfVoiceTranscriptionAborted(signal);
      }
      throw unreachable(error);
    }
    if (response.status === 200) return decodeResult(response.body);
    if (response.status === 410 && attempt === 0) continue;
    throw uploadFailure(response);
  }
}

/** Transcription for review: the text comes back to the draft, nothing is sent. */
export function createServerVoiceTranscriber(input: {
  readonly locale: string;
  readonly transcribe: (uri: string, signal: AbortSignal) => Promise<TranscriptionUploadResult>;
}): VoiceTranscriber {
  return {
    prepare: async () => ({
      locale: input.locale,
      transcribe: async (uri, { signal }) => {
        try {
          return (await input.transcribe(uri, signal)).text;
        } catch (error) {
          if (error instanceof VoiceUploadError) {
            throw new VoiceTranscriptionError("refused", error.message, {
              cause: error,
            });
          }
          throw error;
        }
      },
    }),
  };
}
