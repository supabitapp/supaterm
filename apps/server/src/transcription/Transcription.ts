import {
  type ProviderInstanceId,
  TRANSCRIPTION_MAX_AUDIO_BYTES,
  TRANSCRIPTION_MAX_SECONDS,
  type TranscriptionCancelInput,
  TranscriptionError,
  type TranscriptionErrorReason,
  type TranscriptionTranscribeInput,
  type TranscriptionTranscribeResult,
} from "@supaterm/contracts";
import { parseWav } from "@supaterm/provider-core/server/transcription";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";

import { deletePendingAttachment } from "../assets/AttachmentUpload.ts";
import {
  parseAttachmentFileExtension,
  parseThreadSegmentFromAttachmentId,
  PENDING_ATTACHMENT_THREAD_SEGMENT,
  resolveAttachmentPathById,
} from "../attachmentStore.ts";
import * as ServerConfig from "../config.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import { keytermCandidates } from "./TranscriptionKeyterms.ts";

// At least as long as an upload URL lives, so a replayed upload finds the
// recorded outcome instead of starting another vendor run.
const OUTCOME_TTL_MS = 10 * 60_000;
const MAX_ENTRIES = 64;
const MIN_DURATION_MS = 300;
const RUN_TIMEOUT_MS = (TRANSCRIPTION_MAX_SECONDS + 120) * 1000;
const RUNS_PER_INSTANCE = 2;
const PRUNE_INTERVAL = "1 minute";
const UNUSABLE_AUDIO: ReadonlySet<TranscriptionErrorReason | undefined> = new Set([
  "invalidAudio",
  "audioTooShort",
  "audioTooLong",
]);

interface RunInputs {
  readonly providerInstanceId: ProviderInstanceId;
  readonly language: string | undefined;
}

export interface TranscribeFileInput {
  readonly path: string;
  readonly providerInstanceId: ProviderInstanceId;
  readonly language?: string | undefined;
  readonly context?: TranscriptionTranscribeInput["context"];
}

type Entry =
  | {
      readonly _tag: "Running";
      readonly inputs: RunInputs;
      readonly startedAt: number;
      readonly result: Deferred.Deferred<TranscriptionTranscribeResult, TranscriptionError>;
      readonly fiber: Fiber.Fiber<void>;
    }
  | {
      readonly _tag: "Succeeded";
      readonly inputs: RunInputs;
      readonly settledAt: number;
      readonly result: TranscriptionTranscribeResult;
    }
  | {
      readonly _tag: "Failed";
      readonly inputs: RunInputs;
      readonly settledAt: number;
      readonly error: TranscriptionError;
    };

const sameInputs = (left: RunInputs, right: RunInputs) =>
  left.providerInstanceId === right.providerInstanceId && left.language === right.language;

const expiresAt = (entry: Entry) =>
  entry._tag === "Running" ? entry.startedAt + RUN_TIMEOUT_MS : entry.settledAt + OUTCOME_TTL_MS;

const isPendingWav = (attachmentId: string) =>
  parseThreadSegmentFromAttachmentId(attachmentId) === PENDING_ATTACHMENT_THREAD_SEGMENT &&
  parseAttachmentFileExtension(attachmentId) === "wav";

/** Vendors take a primary language subtag; devices report Norwegian as `nb` or `nn`. */
const normalizeLanguage = (tag: string | undefined) => {
  const primary = tag?.split(/[-_]/)[0]?.toLowerCase();
  if (!primary) return undefined;
  return primary === "nb" || primary === "nn" ? "no" : primary;
};

export class Transcription extends Context.Service<
  Transcription,
  {
    /**
     * Keyed by the upload. A repeat call joins running work or gets the
     * recorded outcome; only `retry` starts over after a failure. The work
     * belongs to the service, so a dropped connection stops only the wait.
     */
    readonly transcribe: (
      input: TranscriptionTranscribeInput,
    ) => Effect.Effect<TranscriptionTranscribeResult, TranscriptionError>;
    readonly cancel: (input: TranscriptionCancelInput) => Effect.Effect<void>;
    /**
     * The instance a request would transcribe with, checked before any audio exists,
     * so a refusal never costs an upload. Omitted means the environment's setting.
     */
    readonly checkSource: (input: {
      readonly providerInstanceId?: ProviderInstanceId | undefined;
      readonly language?: string | undefined;
    }) => Effect.Effect<ProviderInstanceId, TranscriptionError>;
    /** One run on audio the caller owns: no joining, recorded outcome, or deletion. */
    readonly transcribeFile: (
      input: TranscribeFileInput,
    ) => Effect.Effect<TranscriptionTranscribeResult, TranscriptionError>;
  }
>()("supaterm/transcription/Transcription") {}

const make = Effect.gen(function* () {
  const serviceScope = yield* Effect.scope;
  const config = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const providerInstances = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
  const providerRegistry = yield* ProviderRegistry.ProviderRegistry;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const projects = yield* ProjectService.ProjectService;
  const settings = yield* ServerSettings.ServerSettingsService;
  const entriesRef = yield* Ref.make<ReadonlyMap<string, Entry>>(new Map());
  const storeLock = yield* Semaphore.make(1);
  const limitersRef = yield* Ref.make<ReadonlyMap<ProviderInstanceId, Semaphore.Semaphore>>(
    new Map(),
  );

  const deleteUpload = (attachmentId: string) =>
    deletePendingAttachment(attachmentId).pipe(
      Effect.provideService(ServerConfig.ServerConfig, config),
      Effect.provideService(FileSystem.FileSystem, fileSystem),
    );

  const limiterFor = Effect.fnUntraced(function* (instanceId: ProviderInstanceId) {
    const existing = (yield* Ref.get(limitersRef)).get(instanceId);
    if (existing) return existing;
    const candidate = yield* Semaphore.make(RUNS_PER_INSTANCE);
    return yield* Ref.modify(limitersRef, (limiters) => {
      const current = limiters.get(instanceId);
      if (current) return [current, limiters] as const;
      return [candidate, new Map(limiters).set(instanceId, candidate)] as const;
    });
  });

  const readAudio = Effect.fn("Transcription.readAudio")(function* (path: string) {
    const missing = (cause: unknown) => new TranscriptionError({ reason: "audioMissing", cause });
    const info = yield* fileSystem.stat(path).pipe(Effect.mapError(missing));
    if (Number(info.size) > TRANSCRIPTION_MAX_AUDIO_BYTES) {
      return yield* new TranscriptionError({ reason: "audioTooLong" });
    }
    const audio = parseWav(yield* fileSystem.readFile(path).pipe(Effect.mapError(missing)));
    if (!audio) return yield* new TranscriptionError({ reason: "invalidAudio" });
    if (audio.durationMs < MIN_DURATION_MS) {
      return yield* new TranscriptionError({ reason: "audioTooShort" });
    }
    if (audio.durationMs > TRANSCRIPTION_MAX_SECONDS * 1000) {
      return yield* new TranscriptionError({ reason: "audioTooLong" });
    }
    return audio;
  });

  // Every lookup is optional: a missing thread or project only drops its hints.
  const readKeyterms = Effect.fn("Transcription.readKeyterms")(function* (
    instanceId: ProviderInstanceId,
    context: TranscriptionTranscribeInput["context"],
  ) {
    const shell = context?.threadId
      ? yield* projections.getThreadShell(context.threadId).pipe(Effect.orElseSucceed(() => null))
      : null;
    const projectId = shell?.projectId ?? context?.projectId;
    const project = projectId
      ? Option.getOrUndefined(
          yield* projects.getById(projectId).pipe(Effect.orElseSucceed(() => Option.none())),
        )
      : undefined;
    const cwd = shell?.worktreePath ?? project?.workspaceRoot;
    const provider = (yield* providerRegistry.getProviders).find(
      (candidate) => candidate.instanceId === instanceId,
    );
    const workspaceSkills = cwd
      ? provider?.workspaceSnapshots?.find((snapshot) => snapshot.cwd === cwd)?.skills
      : undefined;
    return keytermCandidates({
      projectTitle: project?.title,
      projectFolder: project?.workspaceRoot.split(/[\\/]/).findLast((part) => part !== ""),
      branch: shell?.branch ?? undefined,
      skills: workspaceSkills ?? provider?.skills ?? [],
    });
  });

  // Never another account: an unusable instance is refused, not substituted.
  const resolveInputs = Effect.fnUntraced(function* (input: {
    readonly providerInstanceId?: ProviderInstanceId | undefined;
    readonly language?: string | undefined;
  }) {
    const providerInstanceId =
      input.providerInstanceId ??
      (yield* settings.getSettings.pipe(
        Effect.mapError((cause) => new TranscriptionError({ reason: "sourceUnavailable", cause })),
      )).transcriptionProviderInstanceId;
    return { providerInstanceId, language: normalizeLanguage(input.language) } satisfies RunInputs;
  });

  const resolveSource = Effect.fnUntraced(function* (inputs: RunInputs) {
    const instance = yield* providerInstances.getInstance(inputs.providerInstanceId);
    const backend = instance?.enabled ? instance.transcription : undefined;
    if (!instance || !backend) {
      return yield* new TranscriptionError({ reason: "sourceUnavailable" });
    }
    // The backend reads whatever subscription login is on disk. When the check found that
    // the CLI runs with a different login, using it would bill another account.
    const checked = (yield* instance.snapshot.getSnapshot).transcription;
    if (checked?.status === "unavailable") {
      return yield* new TranscriptionError({ reason: checked.reason ?? "unsupportedLogin" });
    }
    if (inputs.language !== undefined && !backend.supportsLanguage(inputs.language)) {
      return yield* new TranscriptionError({ reason: "unsupportedLanguage" });
    }
    return { instance, backend };
  });

  const run = Effect.fn("Transcription.run")(
    function* (path: string, inputs: RunInputs, context: TranscriptionTranscribeInput["context"]) {
      const { instance, backend } = yield* resolveSource(inputs);
      const audio = yield* readAudio(path);
      const keyterms = backend.acceptsKeyterms
        ? yield* readKeyterms(inputs.providerInstanceId, context)
        : [];
      yield* Effect.annotateCurrentSpan({
        instanceId: inputs.providerInstanceId,
        driver: instance.driverKind,
        audioSeconds: Math.round(audio.durationMs / 1000),
        keytermCount: keyterms.length,
      });
      const limiter = yield* limiterFor(inputs.providerInstanceId);
      return yield* limiter.withPermits(1)(
        backend.transcribe({ audio, language: inputs.language, keyterms }),
      );
    },
    Effect.timeoutOrElse({
      duration: RUN_TIMEOUT_MS,
      orElse: () => Effect.fail(new TranscriptionError({ reason: "failed" })),
    }),
  );

  // An expired failure takes its upload with it, so a late recovery gets
  // `audioMissing` instead of a second vendor run. Callers hold the store lock.
  const pruneExpired = Effect.fnUntraced(function* (now: number) {
    const entries = yield* Ref.get(entriesRef);
    const expiredIds = [...entries].flatMap(([id, entry]) =>
      entry._tag !== "Running" && expiresAt(entry) <= now ? [id] : [],
    );
    if (expiredIds.length === 0) return entries;
    const live = new Map(entries);
    for (const id of expiredIds) live.delete(id);
    yield* Ref.set(entriesRef, live);
    yield* Effect.forEach(expiredIds, deleteUpload, { discard: true });
    return live;
  });

  const settle = Effect.fnUntraced(function* (
    attachmentId: string,
    result: Deferred.Deferred<TranscriptionTranscribeResult, TranscriptionError>,
    inputs: RunInputs,
    exit: Exit.Exit<TranscriptionTranscribeResult, TranscriptionError>,
  ) {
    const settledAt = yield* Clock.currentTimeMillis;
    const outcome =
      exit._tag === "Success"
        ? ({ _tag: "Succeeded", result: exit.value } as const)
        : ({
            _tag: "Failed",
            error: Option.getOrElse(
              Cause.findErrorOption(exit.cause),
              () => new TranscriptionError({ reason: "failed", cause: Cause.squash(exit.cause) }),
            ),
          } as const);
    // Record the outcome before deleting the upload, so a failed delete can't
    // turn a finished vendor call into a second one. Callers hear last, once
    // the upload is already gone.
    // Only `failed` can mean the vendor did work whose result never arrived. Any other
    // refusal spent nothing, so a resubmission simply tries again.
    const recorded = outcome._tag === "Succeeded" || outcome.error.reason === "failed";
    yield* storeLock.withPermits(1)(
      Ref.update(entriesRef, (entries) => {
        const current = entries.get(attachmentId);
        if (current?._tag !== "Running" || current.result !== result) return entries;
        const next = new Map(entries);
        if (recorded) next.set(attachmentId, { ...outcome, inputs, settledAt });
        else next.delete(attachmentId);
        return next;
      }),
    );
    if (outcome._tag === "Succeeded" || UNUSABLE_AUDIO.has(outcome.error.reason)) {
      yield* deleteUpload(attachmentId);
    }
    yield* Deferred.done(
      result,
      outcome._tag === "Succeeded" ? Exit.succeed(outcome.result) : Exit.fail(outcome.error),
    );
  });

  const claim = Effect.fnUntraced(function* (
    input: TranscriptionTranscribeInput,
    inputs: RunInputs,
  ) {
    const attachmentId = input.audioAttachmentId;
    const now = yield* Clock.currentTimeMillis;
    const live = yield* pruneExpired(now);
    const existing = live.get(attachmentId);
    if (existing !== undefined && existing._tag !== "Failed") {
      if (!sameInputs(existing.inputs, inputs)) {
        return Effect.fail(new TranscriptionError({ reason: "requestConflict" }));
      }
      return existing._tag === "Running"
        ? Deferred.await(existing.result)
        : Effect.succeed(existing.result);
    }
    if (existing?._tag === "Failed" && input.retry !== true) return Effect.fail(existing.error);

    const others = [...live].flatMap(([id, entry]) => (id === attachmentId ? [] : [entry]));
    if (others.length >= MAX_ENTRIES) {
      const soonest = Math.min(...others.map(expiresAt));
      return Effect.fail(
        new TranscriptionError({ reason: "rateLimited", retryAfterMs: Math.max(0, soonest - now) }),
      );
    }

    const path = resolveAttachmentPathById({ attachmentsDir: config.attachmentsDir, attachmentId });
    if (!path) return Effect.fail(new TranscriptionError({ reason: "audioMissing" }));
    const result = yield* Deferred.make<TranscriptionTranscribeResult, TranscriptionError>();
    const fiber = yield* run(path, inputs, input.context).pipe(
      Effect.exit,
      Effect.flatMap((exit) => settle(attachmentId, result, inputs, exit)),
      Effect.forkIn(serviceScope),
    );
    yield* Ref.update(entriesRef, (current) =>
      new Map(current).set(attachmentId, {
        _tag: "Running",
        inputs,
        startedAt: now,
        result,
        fiber,
      }),
    );
    return Deferred.await(result);
  });

  const transcribe: Transcription["Service"]["transcribe"] = Effect.fn("Transcription.transcribe")(
    function* (input) {
      if (!isPendingWav(input.audioAttachmentId)) {
        return yield* new TranscriptionError({ reason: "audioMissing" });
      }
      const inputs = yield* resolveInputs(input);
      const outcome = yield* storeLock.withPermits(1)(claim(input, inputs));
      return yield* outcome;
    },
  );

  // Under the store lock throughout, so a reconnect can't start new work on the
  // upload between dropping the entry and deleting the file. Uninterruptible, so
  // a client that disconnects mid-cancel can't leave it half done.
  const cancel: Transcription["Service"]["cancel"] = Effect.fn("Transcription.cancel")(
    function* (input) {
      yield* storeLock
        .withPermits(1)(
          Effect.gen(function* () {
            const entry = (yield* Ref.get(entriesRef)).get(input.audioAttachmentId);
            if (entry) {
              yield* Ref.update(entriesRef, (entries) => {
                const remaining = new Map(entries);
                remaining.delete(input.audioAttachmentId);
                return remaining;
              });
            }
            if (entry?._tag === "Running") {
              yield* Fiber.interrupt(entry.fiber);
              yield* Deferred.fail(entry.result, new TranscriptionError({ reason: "cancelled" }));
            }
            yield* deleteUpload(input.audioAttachmentId);
          }),
        )
        .pipe(Effect.uninterruptible);
    },
  );

  yield* Effect.sleep(PRUNE_INTERVAL).pipe(
    Effect.andThen(Clock.currentTimeMillis),
    Effect.flatMap((now) => storeLock.withPermits(1)(pruneExpired(now))),
    Effect.forever,
    Effect.forkIn(serviceScope),
  );

  const transcribeFile: Transcription["Service"]["transcribeFile"] = (input) =>
    run(
      input.path,
      {
        providerInstanceId: input.providerInstanceId,
        language: normalizeLanguage(input.language),
      },
      input.context,
    );

  const checkSource: Transcription["Service"]["checkSource"] = Effect.fn(
    "Transcription.checkSource",
  )(function* (input) {
    const inputs = yield* resolveInputs(input);
    yield* resolveSource(inputs);
    return inputs.providerInstanceId;
  });

  return Transcription.of({ transcribe, cancel, checkSource, transcribeFile });
});

export const layer = Layer.effect(Transcription, make);
