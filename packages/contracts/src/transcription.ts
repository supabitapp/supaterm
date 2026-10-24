import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  ForwardCompatibleArray,
  ForwardCompatibleNullable,
  NonNegativeInt,
  PositiveInt,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { ChatAttachmentId } from "./chatAttachment.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

export const DICTATION_MAX_DURATION_MS = 300_000;
export const DICTATION_MIN_DURATION_MS = 500;
export const DICTATION_MAX_CLIP_BYTES = 20 * 1024 * 1024;
export const DICTATION_CLIP_EXTENSIONS = ["webm", "ogg", "mp4", "m4a", "wav"] as const;
export type DictationClipExtension = (typeof DICTATION_CLIP_EXTENSIONS)[number];

const DictationSourceKind = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]{0,31}$/));

export const DictationSourceId = Schema.String.check(
  Schema.isPattern(/^[a-z][a-z0-9-]{0,31}:[A-Za-z0-9._-]{1,128}$/),
).pipe(Schema.brand("DictationSourceId"));
export type DictationSourceId = typeof DictationSourceId.Type;

export const DictationSourceDescriptor = Schema.Struct({
  id: DictationSourceId,
  kind: DictationSourceKind,
  runsOn: Schema.Literals(["environment", "device"]),
  label: TrimmedNonEmptyString,
  serviceLabel: TrimmedNonEmptyString,
  accountLabel: Schema.NullOr(TrimmedNonEmptyString),
  providerInstanceId: Schema.optionalKey(ProviderInstanceId),
  eligible: Schema.Boolean,
  unavailableReason: Schema.optionalKey(TrimmedNonEmptyString),

  audioFormats: Schema.Array(TrimmedNonEmptyString),
});
export type DictationSourceDescriptor = typeof DictationSourceDescriptor.Type;

export const DictationSettings = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),

  source: ForwardCompatibleNullable(DictationSourceId).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
});
export type DictationSettings = typeof DictationSettings.Type;

export const DictationSettingsPatch = Schema.Struct({
  enabled: Schema.optionalKey(Schema.Boolean),
  source: Schema.optionalKey(Schema.NullOr(DictationSourceId)),
});
export type DictationSettingsPatch = typeof DictationSettingsPatch.Type;

export const DictationCapability = Schema.Struct({
  maxClipBytes: PositiveInt,
  maxDurationMs: PositiveInt,
});
export type DictationCapability = typeof DictationCapability.Type;

export const DictationCatalog = Schema.Struct({
  sources: ForwardCompatibleArray(DictationSourceDescriptor),
});
export type DictationCatalog = typeof DictationCatalog.Type;

export const DictationTranscribeInput = Schema.Struct({
  attachmentId: ChatAttachmentId,
  sourceId: DictationSourceId,
  durationMs: NonNegativeInt,
  language: Schema.optionalKey(TrimmedNonEmptyString.check(Schema.isMaxLength(35))),
});
export type DictationTranscribeInput = typeof DictationTranscribeInput.Type;

export const DictationTranscribeResult = Schema.Struct({
  text: Schema.String,
  sourceId: DictationSourceId,
});
export type DictationTranscribeResult = typeof DictationTranscribeResult.Type;

export const DictationUpstreamCategory = Schema.Literals([
  "network",
  "timeout",
  "server",
  "bad-response",
]);
export type DictationUpstreamCategory = typeof DictationUpstreamCategory.Type;

export class DictationUnavailableError extends Schema.TaggedError<DictationUnavailableError>()(
  "DictationUnavailableError",
  {
    reason: Schema.Literals([
      "disabled",
      "unknown-source",
      "source-ineligible",
      "endpoint-rejected",
    ]),
  },
) {
  override get message(): string {
    switch (this.reason) {
      case "disabled":
        return "Dictation is turned off for this environment.";
      case "unknown-source":
        return "This transcription source isn't available on this environment.";
      case "source-ineligible":
        return "This transcription source can't transcribe right now.";
      case "endpoint-rejected":
        return "The transcription service rejected the request. Try again later.";
    }
  }
}

export class DictationAuthError extends Schema.TaggedError<DictationAuthError>()(
  "DictationAuthError",
  { sourceId: DictationSourceId },
) {
  override get message(): string {
    return "The transcription account needs to sign in again.";
  }
}

export class DictationRateLimitedError extends Schema.TaggedError<DictationRateLimitedError>()(
  "DictationRateLimitedError",
  { retryAfterSeconds: Schema.NullOr(NonNegativeInt) },
) {
  override get message(): string {
    return "The transcription service is busy. Try again shortly.";
  }
}

export class DictationUpstreamError extends Schema.TaggedError<DictationUpstreamError>()(
  "DictationUpstreamError",
  { category: DictationUpstreamCategory, status: Schema.NullOr(Schema.Int) },
) {
  override get message(): string {
    switch (this.category) {
      case "network":
        return "The transcription service couldn't be reached.";
      case "timeout":
        return "The transcription service took too long to answer.";
      case "server":
        return "The transcription service had a problem.";
      case "bad-response":
        return "The transcription service sent an unexpected answer.";
    }
  }
}

export class DictationClipError extends Schema.TaggedError<DictationClipError>()(
  "DictationClipError",
  {
    problem: Schema.Literals([
      "missing",
      "too-large",
      "too-long",
      "too-short",
      "unsupported-format",
    ]),
  },
) {
  override get message(): string {
    switch (this.problem) {
      case "missing":
        return "The recording wasn't found on the server.";
      case "too-large":
        return "The recording is too large to transcribe.";
      case "too-long":
        return "The recording is too long to transcribe.";
      case "too-short":
        return "The recording is too short to transcribe.";
      case "unsupported-format":
        return "This recording format can't be transcribed.";
    }
  }
}

export const DictationTranscribeError = Schema.Union([
  DictationUnavailableError,
  DictationAuthError,
  DictationRateLimitedError,
  DictationUpstreamError,
  DictationClipError,
]);
export type DictationTranscribeError = typeof DictationTranscribeError.Type;

const compareSourceIds = (left: DictationSourceDescriptor, right: DictationSourceDescriptor) =>
  left.id < right.id ? -1 : left.id > right.id ? 1 : 0;

const sourceKindOf = (id: DictationSourceId) => id.slice(0, id.indexOf(":"));

export function resolveDictationSource(input: {
  readonly sources: ReadonlyArray<DictationSourceDescriptor>;
  readonly settings: Pick<DictationSettings, "enabled" | "source">;
  readonly threadInstanceId?: ProviderInstanceId | null | undefined;
}): DictationSourceDescriptor | null {
  if (!input.settings.enabled) return null;
  const eligible = input.sources.filter((source) => source.eligible).sort(compareSourceIds);
  const chosen = input.settings.source;
  const chosenKind = chosen === null ? null : sourceKindOf(chosen);
  const threadInstanceId = input.threadInstanceId;
  if (threadInstanceId !== undefined && threadInstanceId !== null) {
    const own = eligible.find(
      (source) =>
        source.providerInstanceId === threadInstanceId &&
        (chosenKind === null || source.kind === chosenKind),
    );
    if (own !== undefined) return own;
  }
  if (chosen !== null) {
    const exact = eligible.find((source) => source.id === chosen);
    if (exact !== undefined) return exact;
    const sameKind = eligible.find((source) => source.kind === chosenKind);
    if (sameKind !== undefined) return sameKind;
  }
  return eligible[0] ?? null;
}
