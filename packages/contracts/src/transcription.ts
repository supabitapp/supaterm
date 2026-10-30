import * as Schema from "effect/Schema";

import {
  CommandId,
  ForwardCompatibleOptional,
  MessageId,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { ModelSelection } from "./modelSelection.ts";
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
/** BCP 47 tag. Omitted means the backend's default. */
const TranscriptionLanguage = TrimmedNonEmptyString.check(Schema.isMaxLength(35));
/** Biases recognition toward the project's and branch's names. */
const TranscriptionContext = Schema.Struct({
  projectId: Schema.optionalKey(ProjectId),
  threadId: Schema.optionalKey(ThreadId),
});

export const TranscriptionTranscribeInput = Schema.Struct({
  /** Defaults to the environment's transcription provider setting. */
  providerInstanceId: Schema.optionalKey(ProviderInstanceId),
  audioAttachmentId: AudioAttachmentId,
  language: Schema.optionalKey(TranscriptionLanguage),
  context: Schema.optionalKey(TranscriptionContext),
  /** Starts new work after a recorded failure instead of returning it. */
  retry: Schema.optionalKey(Schema.Boolean),
});
export type TranscriptionTranscribeInput = typeof TranscriptionTranscribeInput.Type;

export const TranscriptionTranscribeResult = Schema.Struct({ text: Schema.String });
export type TranscriptionTranscribeResult = typeof TranscriptionTranscribeResult.Type;

export const TranscriptionCancelInput = Schema.Struct({ audioAttachmentId: AudioAttachmentId });
export type TranscriptionCancelInput = typeof TranscriptionCancelInput.Type;

export const TranscriptionUploadSubmit = Schema.Struct({
  threadId: ThreadId,
  /** Also identifies the upload, so preparing again with it joins the same work. */
  commandId: CommandId,
  messageId: MessageId,
  modelSelection: Schema.optionalKey(ModelSelection),
  /** How the prompt meets a running turn, resolved once the transcript is ready. Defaults to auto. */
  delivery: Schema.optionalKey(Schema.Literals(["auto", "queue", "steer", "restart"])),
  creationSource: Schema.optionalKey(Schema.Literals(["web", "mobile"])),
});
export type TranscriptionUploadSubmit = typeof TranscriptionUploadSubmit.Type;

/**
 * Chooses what finishing the upload does before any audio is sent. Without `submit` the
 * upload answers with the transcript; with it the server also sends the transcript to the
 * thread as the user's message, even when the uploader disconnects first.
 */
export const TranscriptionPrepareUploadInput = Schema.Struct({
  /** Defaults to the environment's transcription provider setting. */
  providerInstanceId: Schema.optionalKey(ProviderInstanceId),
  sizeBytes: NonNegativeInt.check(
    Schema.isGreaterThanOrEqualTo(1),
    Schema.isLessThanOrEqualTo(TRANSCRIPTION_MAX_AUDIO_BYTES),
  ),
  language: Schema.optionalKey(TranscriptionLanguage),
  /** Defaults to the submit thread. */
  context: Schema.optionalKey(TranscriptionContext),
  submit: Schema.optionalKey(TranscriptionUploadSubmit),
});
export type TranscriptionPrepareUploadInput = typeof TranscriptionPrepareUploadInput.Type;

const TranscriptionUploadId = TrimmedNonEmptyString.check(Schema.isMaxLength(256));

/** POST the WAV to `relativeUrl`. Posting it again, even with an empty body, recovers the result. */
export const TranscriptionPrepareUploadResult = Schema.Struct({
  uploadId: TranscriptionUploadId,
  relativeUrl: TrimmedNonEmptyString.check(Schema.isMaxLength(8192)),
  expiresAt: Schema.Number,
});
export type TranscriptionPrepareUploadResult = typeof TranscriptionPrepareUploadResult.Type;

/** The upload's response body. A transcript that was not sent stays with the client. */
export const TranscriptionUploadResult = Schema.Struct({
  text: Schema.String,
  submission: Schema.optionalKey(
    Schema.Union([
      Schema.Struct({ status: Schema.Literal("sent"), sequence: NonNegativeInt }),
      Schema.Struct({ status: Schema.Literals(["noSpeech", "failed"]) }),
    ]),
  ),
});
export type TranscriptionUploadResult = typeof TranscriptionUploadResult.Type;

export const TranscriptionCancelUploadInput = Schema.Struct({ uploadId: TranscriptionUploadId });
export type TranscriptionCancelUploadInput = typeof TranscriptionCancelUploadInput.Type;

/** `tooLate` once the transcript is returned or being sent; nothing is undone then. */
export const TranscriptionCancelUploadResult = Schema.Struct({
  outcome: Schema.Literals(["cancelled", "tooLate"]),
});
export type TranscriptionCancelUploadResult = typeof TranscriptionCancelUploadResult.Type;

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
  uploadExpired: "This upload is no longer available. Prepare a new one.",
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
