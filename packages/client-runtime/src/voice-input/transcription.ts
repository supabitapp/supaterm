import type { VoiceDraftSnapshot } from "./controller.ts";

/** Cancellation is cooperative: settle only after the underlying work has stopped. */
export type VoiceTranscriptionOptions = {
  readonly signal: AbortSignal;
};

export type VoiceTranscribeOptions = VoiceTranscriptionOptions & {
  readonly capturedDraft: VoiceDraftSnapshot;
};

/**
 * A transcriber either returns text for the controller to insert, or reports that it saved the
 * recording, which moves ownership of the audio out of the controller.
 */
export type VoiceTranscriptionResult =
  | { readonly kind: "transcript"; readonly text: string }
  | { readonly kind: "saved"; readonly recordingId: string };

export type PreparedVoiceTranscription = {
  readonly locale: string;
  readonly transcribe: (
    uri: string,
    options: VoiceTranscribeOptions,
  ) => Promise<VoiceTranscriptionResult>;
};

export type VoiceTranscriber = {
  readonly prepare: (options: VoiceTranscriptionOptions) => Promise<PreparedVoiceTranscription>;
};

export type VoiceTranscriptionErrorCode =
  | "unavailable"
  | "unsupported-locale"
  | "preparation-failed"
  | "transcription-failed"
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
