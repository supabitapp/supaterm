import {
  DICTATION_CLIP_EXTENSIONS,
  DICTATION_MAX_CLIP_BYTES,
  DICTATION_MAX_DURATION_MS,
  DICTATION_MIN_DURATION_MS,
  DictationAuthError,
  DictationClipError,
  DictationRateLimitedError,
  DictationSourceDescriptor,
  DictationUnavailableError,
  DictationUpstreamError,
  type DictationClipExtension,
  type DictationRequestId,
  type DictationSourceId,
  type DictationTranscribeError,
  type DictationTranscribeInput,
  type DictationTranscribeResult,
  resolveDictationSource,
} from "@supaterm/contracts";
import type { ProviderInstance } from "@supaterm/provider-core/server/driver";
import type { TranscriptionFailure } from "@supaterm/provider-core/server/transcription";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { deletePendingAttachment } from "../assets/AttachmentUpload.ts";
import {
  parseAttachmentFileExtension,
  parseThreadSegmentFromAttachmentId,
  PENDING_ATTACHMENT_THREAD_SEGMENT,
  resolveAttachmentPathById,
} from "../attachmentStore.ts";
import * as ServerConfig from "../config.ts";
import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";

const SOURCES_DEBOUNCE = Duration.millis(200);

const DURATION_GRACE_MS = 2_000;

// A phone that lost the response while backgrounded asks again with the same
// request id; keeping the text avoids a second upload and vendor call.
const RESULT_RETENTION = Duration.hours(1);

const CLIP_MIME_TYPES: Readonly<Record<DictationClipExtension, string>> = {
  webm: "audio/webm",
  ogg: "audio/ogg",
  mp4: "audio/mp4",
  m4a: "audio/mp4",
  wav: "audio/wav",
};

const isClipExtension = Schema.is(Schema.Literals(DICTATION_CLIP_EXTENSIONS));
const decodeDescriptor = Schema.decodeUnknownOption(DictationSourceDescriptor);

const sameSources = (
  left: ReadonlyArray<DictationSourceDescriptor>,
  right: ReadonlyArray<DictationSourceDescriptor>,
) => JSON.stringify(left) === JSON.stringify(right);

const toTranscribeError = (
  sourceId: DictationSourceId,
  failure: TranscriptionFailure,
): DictationTranscribeError => {
  const { reason } = failure;
  switch (reason._tag) {
    case "auth":
      return new DictationAuthError({ sourceId });
    case "rateLimited":
      return new DictationRateLimitedError({ retryAfterSeconds: reason.retryAfterSeconds });
    case "upstream":
      return new DictationUpstreamError({ category: reason.category, status: reason.status });
    case "endpointRejected":
      return new DictationUnavailableError({ reason: "endpoint-rejected" });
    case "ineligible":
      return new DictationUnavailableError({ reason: "source-ineligible" });
    case "invalidAudio":
      return new DictationClipError({ problem: "unsupported-format" });
  }
};

export class Dictation extends Context.Service<
  Dictation,
  {
    readonly sources: Effect.Effect<ReadonlyArray<DictationSourceDescriptor>>;

    readonly streamSources: Stream.Stream<ReadonlyArray<DictationSourceDescriptor>>;

    readonly transcribe: (
      input: DictationTranscribeInput,
    ) => Effect.Effect<DictationTranscribeResult, DictationTranscribeError>;
  }
>()("supaterm/dictation/Dictation") {}

const make = Effect.gen(function* () {
  const instances = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
  const providers = yield* ProviderRegistry.ProviderRegistry;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const config = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;

  const transcriptionsSettled = yield* PubSub.unbounded<void>();
  const operations = new Map<
    DictationRequestId,
    {
      readonly sourceId: DictationSourceId;
      readonly done: Deferred.Deferred<DictationTranscribeResult, DictationTranscribeError>;
    }
  >();
  const operationScope = yield* Scope.make("parallel");
  yield* Effect.addFinalizer(() => Scope.close(operationScope, Exit.void));

  const describeInstance = (instance: ProviderInstance) =>
    Effect.gen(function* () {
      const transcription = instance.transcription;
      if (!instance.enabled || transcription === undefined) return Option.none();
      const description = yield* transcription.describe;
      if (description === null) return Option.none();
      const snapshot = yield* instance.snapshot.getSnapshot;
      const descriptor = decodeDescriptor({
        id: `${transcription.kind}:${instance.instanceId}`,
        kind: transcription.kind,
        runsOn: "environment",
        label: instance.displayName?.trim() || snapshot.displayName || instance.instanceId,
        serviceLabel: description.serviceLabel,
        accountLabel: description.accountLabel?.trim() || null,
        providerInstanceId: instance.instanceId,
        eligible: description.eligible,
        ...(!description.eligible && description.unavailableReason?.trim()
          ? { unavailableReason: description.unavailableReason }
          : {}),
        audioFormats: description.audioFormats,
      });
      if (Option.isNone(descriptor))
        yield* Effect.logWarning("Skipped a transcription source that does not fit the catalog.", {
          instanceId: instance.instanceId,
          kind: transcription.kind,
        });
      return descriptor;
    });

  const sources = instances.listInstances.pipe(
    Effect.flatMap((all) => Effect.forEach(all, describeInstance, { concurrency: "unbounded" })),
    Effect.map((described) =>
      described
        .flatMap((descriptor) => (Option.isSome(descriptor) ? [descriptor.value] : []))
        .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)),
    ),
  );

  const streamSources = Stream.mergeAll(
    [
      providers.streamChanges.pipe(Stream.map(() => undefined)),
      instances.streamChanges,
      serverSettings.streamChanges.pipe(Stream.map(() => undefined)),
      Stream.fromPubSub(transcriptionsSettled),
      Stream.tick(Duration.minutes(1)),
    ],
    { concurrency: "unbounded" },
  ).pipe(
    Stream.debounce(SOURCES_DEBOUNCE),
    Stream.mapEffect(() => sources),
    Stream.changesWith(sameSources),
  );

  const validateClip = Effect.fnUntraced(function* (
    input: DictationTranscribeInput,
    source: DictationSourceDescriptor,
  ) {
    if (
      parseThreadSegmentFromAttachmentId(input.attachmentId) !== PENDING_ATTACHMENT_THREAD_SEGMENT
    )
      return yield* new DictationClipError({ problem: "missing" });
    const extension = parseAttachmentFileExtension(input.attachmentId);
    if (
      extension === null ||
      !isClipExtension(extension) ||
      !source.audioFormats.includes(extension)
    )
      return yield* new DictationClipError({ problem: "unsupported-format" });
    if (input.durationMs < DICTATION_MIN_DURATION_MS)
      return yield* new DictationClipError({ problem: "too-short" });
    if (input.durationMs > DICTATION_MAX_DURATION_MS + DURATION_GRACE_MS)
      return yield* new DictationClipError({ problem: "too-long" });
    const filePath = resolveAttachmentPathById({
      attachmentsDir: config.attachmentsDir,
      attachmentId: input.attachmentId,
    });
    if (filePath === null) return yield* new DictationClipError({ problem: "missing" });
    const info = yield* fileSystem
      .stat(filePath)
      .pipe(Effect.mapError(() => new DictationClipError({ problem: "missing" })));
    const sizeBytes = Number(info.size);
    if (sizeBytes > DICTATION_MAX_CLIP_BYTES)
      return yield* new DictationClipError({ problem: "too-large" });
    return { filePath, extension, sizeBytes };
  });

  const runTranscription = Effect.fn("Dictation.transcribe")(
    function* (input: DictationTranscribeInput) {
      const settings = yield* serverSettings.getSettings.pipe(Effect.orDie);
      if (!settings.dictation.enabled)
        return yield* new DictationUnavailableError({ reason: "disabled" });
      const catalog = yield* sources;

      const source = resolveDictationSource({
        sources: catalog,
        settings: { enabled: true, source: input.sourceId },
      });
      if (source === null)
        return yield* new DictationUnavailableError({
          reason: catalog.some((entry) => entry.id === input.sourceId)
            ? "source-ineligible"
            : "unknown-source",
        });
      const instance =
        source.providerInstanceId === undefined
          ? undefined
          : yield* instances.getInstance(source.providerInstanceId);
      const transcription = instance?.transcription;
      if (transcription === undefined)
        return yield* new DictationUnavailableError({ reason: "unknown-source" });
      const clip = yield* validateClip(input, source);
      yield* Effect.annotateCurrentSpan({
        "dictation.source_id": source.id,
        "dictation.clip_bytes": clip.sizeBytes,
        "dictation.duration_ms": input.durationMs,
      });
      const startedAtMs = yield* Clock.currentTimeMillis;
      const result = yield* transcription
        .transcribe({
          filePath: clip.filePath,
          fileName: `dictation.${clip.extension}`,
          mimeType: CLIP_MIME_TYPES[clip.extension],
          ...(input.language === undefined ? {} : { language: input.language }),
        })
        .pipe(
          Effect.tapError((failure) =>
            Effect.logInfo("Dictation transcription failed.", {
              sourceId: source.id,
              attachmentId: input.attachmentId,
              clipBytes: clip.sizeBytes,
              reason: failure.reason._tag,
              status: failure.reason._tag === "upstream" ? failure.reason.status : null,
            }),
          ),
          Effect.mapError((failure) => toTranscribeError(source.id, failure)),
        );
      const latencyMs = (yield* Clock.currentTimeMillis) - startedAtMs;
      yield* Effect.logInfo("Dictation transcription finished.", {
        sourceId: source.id,
        attachmentId: input.attachmentId,
        clipBytes: clip.sizeBytes,
        durationMs: input.durationMs,
        latencyMs,
        textLength: result.text.length,
      });
      return { text: result.text.trim(), sourceId: source.id } satisfies DictationTranscribeResult;
    },
    (effect, input) =>
      effect.pipe(
        Effect.ensuring(
          deletePendingAttachment(input.attachmentId).pipe(
            Effect.provideService(ServerConfig.ServerConfig, config),
            Effect.provideService(FileSystem.FileSystem, fileSystem),
            Effect.andThen(PubSub.publish(transcriptionsSettled, undefined)),
          ),
        ),
      ),
  );

  const discardUpload = (input: DictationTranscribeInput) =>
    deletePendingAttachment(input.attachmentId).pipe(
      Effect.provideService(ServerConfig.ServerConfig, config),
      Effect.provideService(FileSystem.FileSystem, fileSystem),
    );

  // The work belongs to the service, not the RPC: a client that disconnects
  // mid-transcription can ask again and join it instead of starting over.
  const transcribe = (input: DictationTranscribeInput) =>
    Effect.gen(function* () {
      const existing = operations.get(input.requestId);
      if (existing !== undefined) {
        if (existing.sourceId !== input.sourceId)
          return yield* new DictationUnavailableError({ reason: "unknown-source" });
        return yield* Deferred.await(existing.done).pipe(Effect.ensuring(discardUpload(input)));
      }
      const done = yield* Deferred.make<DictationTranscribeResult, DictationTranscribeError>();
      operations.set(input.requestId, { sourceId: input.sourceId, done });
      const forget = Effect.sync(() => {
        if (operations.get(input.requestId)?.done === done) operations.delete(input.requestId);
      });
      yield* runTranscription(input).pipe(
        Effect.exit,
        Effect.tap((exit) => Deferred.done(done, exit)),
        Effect.flatMap((exit) =>
          Exit.isSuccess(exit) ? Effect.sleep(RESULT_RETENTION) : Effect.void,
        ),
        Effect.ensuring(forget),
        Effect.forkIn(operationScope),
      );
      return yield* Deferred.await(done);
    });

  return Dictation.of({ sources, streamSources, transcribe });
});

export const layer = Layer.effect(Dictation, make);
