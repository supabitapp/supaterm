import {
  ATTACHMENT_UPLOAD_URL_TTL_MS,
  type AttachmentUploadSigningKeyError,
  type OrchestrationV2Command,
  type TranscriptionCancelUploadInput,
  type TranscriptionCancelUploadResult,
  TranscriptionError,
  TranscriptionPrepareUploadInput,
  type TranscriptionPrepareUploadResult,
  type TranscriptionUploadResult,
  type TranscriptionUploadSubmit,
} from "@supaterm/contracts";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import type * as Stream from "effect/Stream";

import { signUploadToken, verifyUploadToken, writeUploadBody } from "../assets/AttachmentUpload.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as Transcription from "./Transcription.ts";

export const TRANSCRIPTION_UPLOAD_ROUTE_PREFIX = "/api/transcription/uploads";

// A URL can start work for this long after preparation, and an outcome is kept this long
// after settling, so a replayed URL always finds the work it started instead of paying again.
const OUTCOME_TTL_MS = ATTACHMENT_UPLOAD_URL_TTL_MS;
const MAX_ENTRIES = 64;
const PRUNE_INTERVAL = "1 minute";

const UploadClaims = Schema.Struct({
  version: Schema.Literal(1),
  kind: Schema.Literal("transcription-upload"),
  bootId: Schema.String,
  uploadId: Schema.String,
  expiresAt: Schema.Number,
  request: TranscriptionPrepareUploadInput,
});
const uploadClaimsJson = Schema.fromJsonString(UploadClaims);
const decodeUploadClaims = Schema.decodeUnknownOption(uploadClaimsJson);
const encodeUploadClaims = Schema.encodeSync(uploadClaimsJson);
const encodeRequest = Schema.encodeSync(Schema.fromJsonString(TranscriptionPrepareUploadInput));

type Result = Deferred.Deferred<TranscriptionUploadResult, TranscriptionError>;

/** The result identifies the work: an entry replaced by a cancel no longer holds it. */
interface Work {
  readonly result: Result;
  readonly fiber: Fiber.Fiber<void>;
}

type Outcome = Exit.Exit<TranscriptionUploadResult, TranscriptionError>;

/** `request` is the encoded preparation; a cancelled upload has none and answers any request. */
type Entry =
  | { readonly _tag: "Transcribing" | "Submitting"; readonly request: string; readonly work: Work }
  | {
      readonly _tag: "Settled";
      readonly request: string | undefined;
      readonly settledAt: number;
      readonly outcome: Outcome;
    };

const cancelled: Outcome = Exit.fail(new TranscriptionError({ reason: "cancelled" }));

const joinEntry = (entry: Entry, request: string) => {
  if (entry.request !== undefined && entry.request !== request) {
    return Effect.fail(new TranscriptionError({ reason: "requestConflict" }));
  }
  return entry._tag === "Settled" ? entry.outcome : Deferred.await(entry.work.result);
};

const messageDispatch = (
  submit: TranscriptionUploadSubmit,
  text: string,
): Extract<OrchestrationV2Command, { readonly type: "message.dispatch" }> => {
  const delivery = submit.delivery ?? "auto";
  return {
    type: "message.dispatch",
    commandId: submit.commandId,
    threadId: submit.threadId,
    messageId: submit.messageId,
    createdBy: "user",
    creationSource: submit.creationSource ?? "web",
    text,
    attachments: [],
    ...(submit.modelSelection === undefined ? {} : { modelSelection: submit.modelSelection }),
    ...(delivery === "queue" ? {} : { deliveryIntent: delivery }),
    dispatchMode:
      delivery === "queue" ? { type: "queue_after_active" } : { type: "start_immediately" },
  };
};

export class TranscriptionUploads extends Context.Service<
  TranscriptionUploads,
  {
    readonly prepare: (
      input: TranscriptionPrepareUploadInput,
    ) => Effect.Effect<TranscriptionPrepareUploadResult, AttachmentUploadSigningKeyError>;
    /**
     * Once the body is stored the work belongs to the service, so interrupting the caller
     * only stops its wait. Without a body it recovers the outcome of an earlier upload.
     */
    readonly receive: <E>(
      token: string,
      body: Stream.Stream<Uint8Array, E> | undefined,
    ) => Effect.Effect<TranscriptionUploadResult, TranscriptionError>;
    readonly cancel: (
      input: TranscriptionCancelUploadInput,
    ) => Effect.Effect<TranscriptionCancelUploadResult>;
  }
>()("supaterm/transcription/TranscriptionUploads") {}

const make = Effect.gen(function* () {
  const serviceScope = yield* Effect.scope;
  const config = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const secretStore = yield* ServerSecretStore.ServerSecretStore;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const transcription = yield* Transcription.Transcription;
  const entriesRef = yield* Ref.make<ReadonlyMap<string, Entry>>(new Map());
  const storeLock = yield* Semaphore.make(1);
  const randomId = crypto.randomUUIDv4().pipe(Effect.orDie);
  // Outcomes don't survive a restart, so URLs issued before it must not start work again.
  const bootId = yield* randomId;
  // Kept apart from pending attachments, so the attachment and transcription APIs can't
  // transcribe, discard, or sweep audio this service is working on.
  const directory = path.join(config.stateDir, "transcription-uploads");
  yield* fileSystem.remove(directory, { recursive: true, force: true }).pipe(Effect.ignore);
  const removeFile = (file: string) => fileSystem.remove(file, { force: true }).pipe(Effect.ignore);

  // Callers hold the store lock.
  const pruneExpired = Effect.fnUntraced(function* (now: number) {
    const entries = yield* Ref.get(entriesRef);
    const live = new Map(
      [...entries].filter(
        ([, entry]) => entry._tag !== "Settled" || entry.settledAt + OUTCOME_TTL_MS > now,
      ),
    );
    if (live.size !== entries.size) yield* Ref.set(entriesRef, live);
    return live;
  });
  const liveEntries = Effect.flatMap(Clock.currentTimeMillis, pruneExpired);

  // Only the entry's own work settles it; a cancel that replaced it has already answered.
  const settle = Effect.fnUntraced(function* (uploadId: string, result: Result, exit: Outcome) {
    const outcome = Exit.isSuccess(exit)
      ? exit
      : Exit.fail(
          Option.getOrElse(
            Cause.findErrorOption(exit.cause),
            () => new TranscriptionError({ reason: "failed", cause: Cause.squash(exit.cause) }),
          ),
        );
    const settledAt = yield* Clock.currentTimeMillis;
    const owned = yield* storeLock.withPermits(1)(
      Ref.modify(entriesRef, (entries) => {
        const entry = entries.get(uploadId);
        if (entry === undefined || entry._tag === "Settled" || entry.work.result !== result) {
          return [false, entries] as const;
        }
        const next = new Map(entries).set(uploadId, {
          _tag: "Settled",
          request: entry.request,
          settledAt,
          outcome,
        });
        return [true, next] as const;
      }),
    );
    if (owned) yield* Deferred.done(result, outcome);
  });

  const submit = Effect.fn("TranscriptionUploads.submit")(function* (
    uploadId: string,
    result: Result,
    target: TranscriptionUploadSubmit,
    text: string,
  ) {
    if (text.trim().length === 0) {
      return { text, submission: { status: "noSpeech" } } satisfies TranscriptionUploadResult;
    }
    // Cancelling takes the same lock, so it either stops the work first or finds it sending.
    const sending = yield* storeLock.withPermits(1)(
      Ref.modify(entriesRef, (entries) => {
        const entry = entries.get(uploadId);
        if (entry?._tag !== "Transcribing" || entry.work.result !== result) {
          return [false, entries] as const;
        }
        return [true, new Map(entries).set(uploadId, { ...entry, _tag: "Submitting" })] as const;
      }),
    );
    if (!sending) return yield* Effect.interrupt;
    const dispatched = yield* threads.dispatch(messageDispatch(target, text)).pipe(Effect.exit);
    if (Exit.isSuccess(dispatched)) {
      return {
        text,
        submission: { status: "sent", sequence: dispatched.value.sequence },
      } satisfies TranscriptionUploadResult;
    }
    yield* Effect.logWarning("Failed to send a transcribed prompt.", {
      threadId: target.threadId,
      cause: dispatched.cause,
    });
    return { text, submission: { status: "failed" } } satisfies TranscriptionUploadResult;
  });

  const run = (
    uploadId: string,
    request: TranscriptionPrepareUploadInput,
    audioPath: string,
    result: Result,
  ) =>
    transcription
      .transcribeFile({
        path: audioPath,
        providerInstanceId: request.providerInstanceId,
        language: request.language,
        context: request.context ?? (request.submit && { threadId: request.submit.threadId }),
      })
      .pipe(
        Effect.ensuring(removeFile(audioPath)),
        Effect.flatMap(({ text }): Effect.Effect<TranscriptionUploadResult, TranscriptionError> =>
          request.submit === undefined
            ? Effect.succeed({ text })
            : submit(uploadId, result, request.submit, text),
        ),
        Effect.exit,
        Effect.flatMap((exit) => settle(uploadId, result, exit)),
      );

  // Runs under the store lock and uninterruptibly: once the audio is in place the work
  // is registered and running, so a disconnect after this can't strand the upload.
  const accept = Effect.fnUntraced(function* (
    uploadId: string,
    claims: typeof UploadClaims.Type,
    request: string,
    partPath: string,
  ) {
    const live = yield* liveEntries;
    const existing = live.get(uploadId);
    if (existing !== undefined) return joinEntry(existing, request);
    if (live.size >= MAX_ENTRIES) {
      return Effect.fail(new TranscriptionError({ reason: "rateLimited" }));
    }
    const audioPath = path.join(directory, `${yield* randomId}.wav`);
    const renamed = yield* fileSystem.rename(partPath, audioPath).pipe(Effect.exit);
    if (Exit.isFailure(renamed)) {
      return Effect.fail(
        new TranscriptionError({ reason: "failed", cause: Cause.squash(renamed.cause) }),
      );
    }
    const result = yield* Deferred.make<TranscriptionUploadResult, TranscriptionError>();
    const fiber = yield* run(uploadId, claims.request, audioPath, result).pipe(
      Effect.forkIn(serviceScope),
    );
    yield* Ref.update(entriesRef, (entries) =>
      new Map(entries).set(uploadId, {
        _tag: "Transcribing",
        request,
        work: { result, fiber },
      }),
    );
    return Deferred.await(result);
  });

  const receive: TranscriptionUploads["Service"]["receive"] = Effect.fn(
    "TranscriptionUploads.receive",
  )(function* <E>(token: string, body: Stream.Stream<Uint8Array, E> | undefined) {
    const payload = yield* verifyUploadToken(token).pipe(
      Effect.provideService(ServerSecretStore.ServerSecretStore, secretStore),
    );
    const claims =
      payload === null ? undefined : Option.getOrUndefined(decodeUploadClaims(payload));
    if (claims === undefined || claims.bootId !== bootId) {
      return yield* new TranscriptionError({ reason: "uploadExpired" });
    }
    const { uploadId } = claims;
    const request = encodeRequest(claims.request);
    const known = (yield* storeLock.withPermits(1)(liveEntries)).get(uploadId);
    if (known !== undefined) return yield* joinEntry(known, request);
    if (body === undefined || claims.expiresAt <= (yield* Clock.currentTimeMillis)) {
      return yield* new TranscriptionError({ reason: "uploadExpired" });
    }

    const partPath = path.join(directory, `${yield* randomId}.part`);
    const outcome = yield* Effect.uninterruptibleMask((restore) =>
      restore(writeUploadBody(body, claims.request.sizeBytes, partPath)).pipe(
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.provideService(Path.Path, path),
        Effect.mapError((cause) => new TranscriptionError({ reason: "failed", cause })),
        Effect.flatMap((receivedBytes) =>
          receivedBytes === claims.request.sizeBytes
            ? storeLock.withPermits(1)(accept(uploadId, claims, request, partPath))
            : Effect.fail(new TranscriptionError({ reason: "invalidAudio" })),
        ),
        Effect.ensuring(removeFile(partPath)),
      ),
    );
    return yield* outcome;
  });

  const prepare: TranscriptionUploads["Service"]["prepare"] = Effect.fn(
    "TranscriptionUploads.prepare",
  )(function* (input) {
    const uploadId = input.submit?.commandId ?? (yield* randomId);
    const expiresAt = (yield* Clock.currentTimeMillis) + ATTACHMENT_UPLOAD_URL_TTL_MS;
    const token = yield* signUploadToken(
      encodeUploadClaims({
        version: 1,
        kind: "transcription-upload",
        bootId,
        uploadId,
        expiresAt,
        request: input,
      }),
    ).pipe(Effect.provideService(ServerSecretStore.ServerSecretStore, secretStore));
    return { uploadId, relativeUrl: `${TRANSCRIPTION_UPLOAD_ROUTE_PREFIX}/${token}`, expiresAt };
  });

  // Uninterruptible, so a caller that disconnects mid-cancel can't leave it half done.
  const cancel: TranscriptionUploads["Service"]["cancel"] = Effect.fn(
    "TranscriptionUploads.cancel",
  )(function* ({ uploadId }) {
    const decision = yield* storeLock.withPermits(1)(
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const live = yield* pruneExpired(now);
        const entry = live.get(uploadId);
        if (
          entry?._tag === "Submitting" ||
          (entry?._tag === "Settled" && entry.request !== undefined)
        ) {
          return { outcome: "tooLate" } as const;
        }
        // Recorded even when nothing is known yet, so an upload still on its way can't start.
        yield* Ref.set(
          entriesRef,
          new Map(live).set(uploadId, {
            _tag: "Settled",
            request: undefined,
            settledAt: now,
            outcome: cancelled,
          }),
        );
        return {
          outcome: "cancelled",
          stopped: entry?._tag === "Transcribing" ? entry.work : undefined,
        } as const;
      }),
    );
    if (decision.outcome === "cancelled" && decision.stopped !== undefined) {
      yield* Fiber.interrupt(decision.stopped.fiber);
      yield* Deferred.done(decision.stopped.result, cancelled);
    }
    return { outcome: decision.outcome };
  }, Effect.uninterruptible);

  yield* Effect.sleep(PRUNE_INTERVAL).pipe(
    Effect.andThen(storeLock.withPermits(1)(liveEntries)),
    Effect.forever,
    Effect.forkIn(serviceScope),
  );

  return TranscriptionUploads.of({ prepare, receive, cancel });
});

export const layer = Layer.effect(TranscriptionUploads, make);
