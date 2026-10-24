import { DictationUpstreamCategory } from "@supaterm/contracts";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export interface TranscriptionSourceDescription {
  readonly serviceLabel: string;
  readonly accountLabel: string | null;
  readonly eligible: boolean;
  readonly unavailableReason?: string | undefined;

  readonly audioFormats: ReadonlyArray<string>;
}

export interface TranscriptionClip {
  readonly filePath: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly language?: string | undefined;
}

const TranscriptionFailureReason = Schema.TaggedUnion({
  auth: {},
  rateLimited: { retryAfterSeconds: Schema.NullOr(Schema.Int) },
  upstream: { category: DictationUpstreamCategory, status: Schema.NullOr(Schema.Int) },
  endpointRejected: {},
  ineligible: { reason: Schema.String },
  invalidAudio: {},
});
export type TranscriptionFailureReason = typeof TranscriptionFailureReason.Type;

export class TranscriptionFailure extends Schema.TaggedError<TranscriptionFailure>()(
  "TranscriptionFailure",
  { reason: TranscriptionFailureReason },
) {
  override get message(): string {
    return `Transcription failed: ${this.reason._tag}.`;
  }
}

export interface ProviderTranscription {
  readonly kind: string;

  readonly describe: Effect.Effect<TranscriptionSourceDescription | null>;
  readonly transcribe: (
    clip: TranscriptionClip,
  ) => Effect.Effect<{ readonly text: string }, TranscriptionFailure>;
}
