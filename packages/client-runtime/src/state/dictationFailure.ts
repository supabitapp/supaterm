import { shouldRetryThreadOutboxDelivery } from "../threadOutboxPolicy.ts";

export type DictationFailureKind = "transient" | "terminal" | "empty" | "cancelled";

export class DictationClipFailure extends Error {
  readonly kind: DictationFailureKind;

  constructor(kind: DictationFailureKind, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DictationClipFailure";
    this.kind = kind;
  }
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

/**
 * Transient failures keep the recording waiting for an automatic retry; terminal ones keep it
 * for an explicit retry. Neither discards audio.
 */
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
