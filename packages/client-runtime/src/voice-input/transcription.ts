/** Cancellation is cooperative: settle only after the underlying work has stopped. */
export type VoiceTranscriptionOptions = {
  readonly signal: AbortSignal;
};

export type PreparedVoiceTranscription = {
  readonly locale: string;
  readonly transcribe: (uri: string, options: VoiceTranscriptionOptions) => Promise<string>;
  /**
   * Ends a recording that becomes a voice message instead of a transcript. Returns the id the
   * message must be sent under, so the environment joins audio it already has.
   */
  readonly handOff?: () => VoiceRecordingHandOff;
  /** Stops work the recording never got to use; safe to call more than once. */
  readonly dispose?: () => void;
};

export type VoiceRecordingHandOff = {
  readonly uploadId: string;
  /** The audio already went to the environment while it was recorded. */
  readonly streamed: boolean;
};

export type VoiceTranscriber = {
  readonly prepare: (options: VoiceTranscriptionOptions) => Promise<PreparedVoiceTranscription>;
};

export type VoiceTranscriptionErrorCode =
  /** The environment declined with a reason the user can act on, carried in the message. */
  | "refused"
  /** Too little audio to transcribe, as from a tap; the recording is dropped without a word. */
  | "tooShort"
  | "cancelled";

export class VoiceTranscriptionError extends Error {
  readonly code: VoiceTranscriptionErrorCode;

  constructor(code: VoiceTranscriptionErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "VoiceTranscriptionError";
    this.code = code;
  }
}

export function throwIfVoiceTranscriptionAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new VoiceTranscriptionError("cancelled", "Voice transcription was cancelled.");
  }
}
