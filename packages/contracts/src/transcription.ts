import * as Schema from "effect/Schema";

import {
  ForwardCompatibleOptional,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

/** 5 minutes of 16 kHz mono 16-bit PCM is 9.6 MB, plus the WAV header. */
export const TRANSCRIPTION_MAX_AUDIO_BYTES = 10 * 1024 * 1024;
export const TRANSCRIPTION_MAX_SECONDS = 5 * 60;

export const ServerProviderTranscription = Schema.Struct({
  status: Schema.Literals(["ready", "unavailable"]),
  reason: ForwardCompatibleOptional(Schema.Literals(["unsupportedLogin", "signedOut"])),
});
export type ServerProviderTranscription = typeof ServerProviderTranscription.Type;

const AudioAttachmentId = TrimmedNonEmptyString.check(Schema.isMaxLength(256));

export const TranscriptionTranscribeInput = Schema.Struct({
  providerInstanceId: ProviderInstanceId,
  audioAttachmentId: AudioAttachmentId,
  /** BCP 47 tag. Omitted means the backend's default. */
  language: Schema.optionalKey(TrimmedNonEmptyString.check(Schema.isMaxLength(35))),
  context: Schema.optionalKey(
    Schema.Struct({
      projectId: Schema.optionalKey(ProjectId),
      threadId: Schema.optionalKey(ThreadId),
    }),
  ),
  /** Starts new work after a recorded failure instead of returning it. */
  retry: Schema.optionalKey(Schema.Boolean),
});
export type TranscriptionTranscribeInput = typeof TranscriptionTranscribeInput.Type;

export const TranscriptionTranscribeResult = Schema.Struct({ text: Schema.String });
export type TranscriptionTranscribeResult = typeof TranscriptionTranscribeResult.Type;

export const TranscriptionCancelInput = Schema.Struct({ audioAttachmentId: AudioAttachmentId });
export type TranscriptionCancelInput = typeof TranscriptionCancelInput.Type;

const TRANSCRIPTION_ERROR_MESSAGES = {
  sourceUnavailable: "This provider can't transcribe audio.",
  unsupportedLogin: "This provider's login can't be used for transcription.",
  signedOut: "Sign in to this provider again to transcribe.",
  credentialsLocked:
    "The login keychain is locked on the machine running Supaterm. Unlock it and try again.",
  audioMissing: "The recording is no longer available. Record it again.",
  invalidAudio: "The recording must be 16 kHz mono 16-bit WAV audio.",
  audioTooShort: "The recording is too short to transcribe.",
  audioTooLong: "The recording is too long to transcribe.",
  unsupportedLanguage: "This provider can't transcribe that language.",
  rateLimited: "Transcription is rate limited. Try again soon.",
  blocked: "The provider refused to transcribe. Voice may not be available for this account.",
  requestConflict: "This recording is already being transcribed with different settings.",
  cancelled: "Transcription was cancelled.",
  failed: "Transcription failed.",
} as const;

export const TranscriptionErrorReason = Schema.Literals(
  Object.keys(TRANSCRIPTION_ERROR_MESSAGES) as Array<keyof typeof TRANSCRIPTION_ERROR_MESSAGES>,
);
export type TranscriptionErrorReason = typeof TranscriptionErrorReason.Type;

export class TranscriptionError extends Schema.TaggedError<TranscriptionError>()(
  "TranscriptionError",
  {
    reason: ForwardCompatibleOptional(TranscriptionErrorReason),
    retryAfterMs: Schema.optional(NonNegativeInt),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.reason === undefined
      ? TRANSCRIPTION_ERROR_MESSAGES.failed
      : TRANSCRIPTION_ERROR_MESSAGES[this.reason];
  }
}
