import {
  ATTACHMENT_UPLOAD_URL_TTL_MS,
  type AttachmentUploadSigningKeyError,
  type OrchestrationV2Command,
  ProviderInstanceId,
  TRANSCRIPTION_MAX_SECONDS,
  TRANSCRIPTION_STREAM_CLOSED_CODE,
  type TranscriptionCancelUploadInput,
  type TranscriptionCancelUploadResult,
  TranscriptionError,
  TranscriptionPrepareStreamInput,
  TranscriptionPrepareUploadInput,
  type TranscriptionPrepareUploadResult,
  TranscriptionStreamFinish,
  TranscriptionStreamServerMessage,
  type TranscriptionUploadResult,
  type TranscriptionUploadSubmit,
} from "@supaterm/contracts";
import { PCM_BYTES_PER_SECOND, parseWav } from "@supaterm/provider-core/server/transcription";
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
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Socket from "effect/socket/Socket";
import * as Stream from "effect/Stream";

import { signUploadToken, verifyUploadToken, writeUploadBody } from "../assets/AttachmentUpload.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as Transcription from "./Transcription.ts";

export const TRANSCRIPTION_UPLOAD_ROUTE_PREFIX = "/api/transcription/uploads";
export const TRANSCRIPTION_STREAM_ROUTE_PREFIX = "/api/transcription/streams";

// A URL can start work for this long after preparation. An entry outlives every URL issued for
// it, so a replayed or re-prepared URL finds the work or cancellation instead of starting again.
const OUTCOME_TTL_MS = ATTACHMENT_UPLOAD_URL_TTL_MS;
const MAX_ENTRIES = 64;
const PRUNE_INTERVAL = "1 minute";
const MAX_STREAM_BYTES = TRANSCRIPTION_MAX_SECONDS * PCM_BYTES_PER_SECOND;
// How long a stream that lost its client keeps the vendor session for it to come back.
const DETACHED_GRACE = "30 seconds";

const UploadClaims = Schema.Struct({
  version: Schema.Literal(1),
  kind: Schema.Literal("transcription-upload"),
  bootId: Schema.String,
  uploadId: Schema.String,
  expiresAt: Schema.Number,
  /** Resolved when prepared, so a settings change can't move a replay to another account. */
  providerInstanceId: ProviderInstanceId,
  request: TranscriptionPrepareUploadInput,
});
const uploadClaimsJson = Schema.fromJsonString(UploadClaims);
const decodeUploadClaims = Schema.decodeUnknownOption(uploadClaimsJson);
const encodeUploadClaims = Schema.encodeSync(uploadClaimsJson);
const encodeRequest = Schema.encodeSync(Schema.fromJsonString(TranscriptionPrepareUploadInput));

const StreamClaims = Schema.Struct({
  version: Schema.Literal(1),
  kind: Schema.Literal("transcription-stream"),
  bootId: Schema.String,
  uploadId: Schema.String,
  expiresAt: Schema.Number,
  providerInstanceId: ProviderInstanceId,
  /** The session that may send audio; the stream ends once it is revoked. */
  sessionId: Schema.String,
  request: TranscriptionPrepareStreamInput,
});
const streamClaimsJson = Schema.fromJsonString(StreamClaims);
const decodeStreamClaims = Schema.decodeUnknownOption(streamClaimsJson);
const encodeStreamClaims = Schema.encodeSync(streamClaimsJson);
const encodeServerMessage = Schema.encodeSync(
  Schema.fromJsonString(TranscriptionStreamServerMessage),
);
const decodeFinish = Schema.decodeUnknownOption(Schema.fromJsonString(TranscriptionStreamFinish));

type Result = Deferred.Deferred<TranscriptionUploadResult, TranscriptionError>;

/** The result identifies the work: an entry replaced by a cancel no longer holds it. */
interface Work {
  readonly result: Result;
  readonly fiber: Fiber.Fiber<void>;
}

type Outcome = Exit.Exit<TranscriptionUploadResult, TranscriptionError>;

/**
 * Audio of a dictation still being recorded, fed to the vendor as it arrives. Only one
 * connection at a time sends it; `lock` orders that sender against an upload of the rest.
 */
interface Live {
  readonly audio: Queue.Queue<Uint8Array, Cause.Done>;
  readonly lock: Semaphore.Semaphore;
  receivedBytes: number;
  finished: boolean;
  /** Ends every connection once audio stops counting; `true` asks the client to upload instead. */
  readonly closed: Deferred.Deferred<boolean>;
  /** Completing it fences the connection that holds it. */
  attachment: Deferred.Deferred<void>;
}

/**
 * `request` is the encoded preparation; a streamed dictation has none, and any upload naming
 * its id joins it. A cancelled upload answers every request alike. `retainUntil` covers the
 * latest URL issued for the upload; running work is never dropped.
 */
type Entry =
  | {
      readonly _tag: "Transcribing" | "Submitting";
      readonly request: string | undefined;
      readonly providerInstanceId: ProviderInstanceId;
      readonly work: Work;
      readonly retainUntil: number;
      readonly live?: Live;
      /** Where a streamed dictation goes once transcribed, when a voice message names it. */
      readonly submit?: TranscriptionUploadSubmit;
    }
  | {
      readonly _tag: "Settled";
      readonly request: string | undefined;
      readonly providerInstanceId: ProviderInstanceId;
      readonly retainUntil: number;
      readonly outcome: Outcome;
      readonly submit?: TranscriptionUploadSubmit;
    }
  | { readonly _tag: "Cancelled"; readonly retainUntil: number };

const cancelled: Outcome = Exit.fail(new TranscriptionError({ reason: "cancelled" }));

const joinEntry = (entry: Entry, request: string) => {
  if (entry._tag === "Cancelled") return cancelled;
  if (entry.request !== undefined && entry.request !== request) {
    return Effect.fail(new TranscriptionError({ reason: "requestConflict" }));
  }
  return entry._tag === "Settled" ? entry.outcome : Deferred.await(entry.work.result);
};

type TranscriptDecision =
  | { readonly _tag: "gone" }
  | { readonly _tag: "settled"; readonly live: Live | undefined }
  | { readonly _tag: "submit"; readonly target: TranscriptionUploadSubmit };

const settledEntry = (
  entry: Extract<Entry, { readonly work: Work }>,
  outcome: Outcome,
  settledAt: number,
): Entry => ({
  _tag: "Settled",
  request: entry.request,
  providerInstanceId: entry.providerInstanceId,
  retainUntil: Math.max(entry.retainUntil, settledAt + OUTCOME_TTL_MS),
  outcome,
  ...(entry.submit === undefined ? {} : { submit: entry.submit }),
});

const sameTarget = (left: TranscriptionUploadSubmit, right: TranscriptionUploadSubmit) =>
  left.threadId === right.threadId &&
  left.commandId === right.commandId &&
  left.messageId === right.messageId;

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
    ) => Effect.Effect<
      TranscriptionPrepareUploadResult,
      AttachmentUploadSigningKeyError | TranscriptionError
    >;
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
    readonly prepareStream: (
      input: TranscriptionPrepareStreamInput,
      sessionId: string,
    ) => Effect.Effect<
      TranscriptionPrepareUploadResult,
      AttachmentUploadSigningKeyError | TranscriptionError
    >;
    /**
     * Takes a dictation's audio from `socket` until it finishes or the client goes away.
     * `revoked` completes when a session loses access, which cancels the dictation.
     */
    readonly attachStream: (
      token: string,
      socket: Socket.Socket,
      revoked: (sessionId: string) => Effect.Effect<void>,
    ) => Effect.Effect<void, never, Scope.Scope>;
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
      [...entries].filter(([, entry]) => "work" in entry || entry.retainUntil > now),
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
        if (!(entry && "work" in entry) || entry.work.result !== result) {
          return [undefined, entries] as const;
        }
        return [
          entry,
          new Map(entries).set(uploadId, settledEntry(entry, outcome, settledAt)),
        ] as const;
      }),
    );
    if (owned === undefined) return;
    yield* Deferred.done(result, outcome);
    if (owned.live) yield* closeLive(owned.live, false);
  });

  const dispatchTranscript = Effect.fnUntraced(function* (
    target: TranscriptionUploadSubmit,
    text: string,
  ) {
    if (text.trim().length === 0) {
      return { text, submission: { status: "noSpeech" } } satisfies TranscriptionUploadResult;
    }
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
    return yield* dispatchTranscript(target, text);
  });

  const closeLive = (live: Live, upload: boolean) =>
    Effect.andThen(Deferred.succeed(live.closed, upload), Queue.shutdown(live.audio));

  // Callers hold the live lock.
  const offerAudio = (live: Live, chunk: Uint8Array) => {
    const room = MAX_STREAM_BYTES - live.receivedBytes;
    if (live.finished || room <= 0 || chunk.byteLength === 0) return Effect.void;
    const kept = chunk.byteLength > room ? chunk.subarray(0, room) : chunk;
    live.receivedBytes += kept.byteLength;
    return Queue.offer(live.audio, kept);
  };
  const appendLive = (live: Live, chunk: Uint8Array) =>
    live.lock.withPermits(1)(Effect.suspend(() => offerAudio(live, chunk)));
  /** Ends the audio. `recording` is the whole clip from its start; only what was missed is sent. */
  const completeLive = (live: Live, recording?: Uint8Array) =>
    live.lock.withPermits(1)(
      Effect.suspend(() => {
        if (live.finished) return Effect.void;
        const missed = recording?.subarray(live.receivedBytes) ?? new Uint8Array();
        return offerAudio(live, missed).pipe(
          Effect.andThen(
            Effect.sync(() => {
              live.finished = true;
            }),
          ),
          Effect.andThen(Queue.end(live.audio)),
        );
      }),
    );

  // A refusal before any audio reached the vendor spent nothing: forget the dictation, so the
  // client's upload of the recording runs as a fresh transcription.
  const abandonLive = Effect.fnUntraced(function* (uploadId: string, result: Result, live: Live) {
    const owned = yield* storeLock.withPermits(1)(
      Ref.modify(entriesRef, (entries) => {
        const entry = entries.get(uploadId);
        if (!(entry && "work" in entry) || entry.work.result !== result) {
          return [false, entries] as const;
        }
        const next = new Map(entries);
        next.delete(uploadId);
        return [true, next] as const;
      }),
    );
    if (!owned) return;
    yield* Deferred.fail(result, new TranscriptionError({ reason: "uploadExpired" }));
    yield* closeLive(live, true);
  });

  // Decided under the lock that also records a voice message's target, so a Send that
  // arrives as the transcript lands is either sent here or by the upload that carried it.
  const finishTranscript = Effect.fnUntraced(function* (
    uploadId: string,
    result: Result,
    text: string,
  ) {
    const settledAt = yield* Clock.currentTimeMillis;
    const decision = yield* storeLock.withPermits(1)(
      Ref.modify(
        entriesRef,
        (entries): readonly [TranscriptDecision, ReadonlyMap<string, Entry>] => {
          const entry = entries.get(uploadId);
          if (entry?._tag !== "Transcribing" || entry.work.result !== result) {
            return [{ _tag: "gone" }, entries];
          }
          if (entry.submit === undefined) {
            const next = new Map(entries).set(
              uploadId,
              settledEntry(entry, Exit.succeed({ text }), settledAt),
            );
            return [{ _tag: "settled", live: entry.live }, next];
          }
          const next = new Map(entries).set(uploadId, { ...entry, _tag: "Submitting" as const });
          return [{ _tag: "submit", target: entry.submit }, next];
        },
      ),
    );
    if (decision._tag === "gone") return;
    if (decision._tag === "settled") {
      yield* Deferred.succeed(result, { text });
      if (decision.live) yield* closeLive(decision.live, false);
      return;
    }
    const sent = yield* dispatchTranscript(decision.target, text);
    yield* settle(uploadId, result, Exit.succeed(sent));
  });

  const runLive = (
    uploadId: string,
    claims: typeof StreamClaims.Type,
    live: Live,
    result: Result,
  ) =>
    transcription
      .transcribeLive({
        providerInstanceId: claims.providerInstanceId,
        language: claims.request.language,
        context: claims.request.context,
        audio: Stream.fromQueue(live.audio),
      })
      .pipe(
        Effect.exit,
        Effect.flatMap((exit) => {
          if (Exit.isSuccess(exit)) return finishTranscript(uploadId, result, exit.value.text);
          const error = Option.getOrUndefined(Cause.findErrorOption(exit.cause));
          if (error?._tag === "LiveTranscriptionUnavailable") {
            return Effect.logInfo("Live transcription is unavailable; the recording is uploaded.", {
              reason: error.cause.reason,
            }).pipe(Effect.andThen(abandonLive(uploadId, result, live)));
          }
          return settle(
            uploadId,
            result,
            Exit.fail(
              error ??
                new TranscriptionError({ reason: "failed", cause: Cause.squash(exit.cause) }),
            ),
          );
        }),
      );

  // A stream that lost its client without finishing can't be completed honestly: the vendor
  // already heard part of it, so it fails and only a deliberate retry spends again.
  const expireDetached = Effect.fnUntraced(function* (
    uploadId: string,
    live: Live,
    attachment: Deferred.Deferred<void>,
  ) {
    yield* Effect.sleep(DETACHED_GRACE);
    const settledAt = yield* Clock.currentTimeMillis;
    const failure = new TranscriptionError({ reason: "failed" });
    const stopped = yield* storeLock.withPermits(1)(
      Ref.modify(entriesRef, (entries) => {
        const entry = entries.get(uploadId);
        if (
          entry?._tag !== "Transcribing" ||
          entry.live !== live ||
          live.finished ||
          live.attachment !== attachment
        ) {
          return [undefined, entries] as const;
        }
        const next = new Map(entries).set(
          uploadId,
          settledEntry(entry, Exit.fail(failure), settledAt),
        );
        return [entry.work, next] as const;
      }),
    );
    if (stopped === undefined) return;
    yield* Fiber.interrupt(stopped.fiber);
    yield* Deferred.fail(stopped.result, failure);
    yield* closeLive(live, false);
  });

  // Callers hold the store lock. A second connection takes the stream over from the first.
  const attach = Effect.fnUntraced(function* (claims: typeof StreamClaims.Type) {
    const entries = yield* liveEntries;
    const existing = entries.get(claims.uploadId);
    if (existing !== undefined) {
      if (existing._tag !== "Transcribing" || !existing.live || existing.live.finished) {
        return undefined;
      }
      const stream = existing.live;
      const previous = stream.attachment;
      stream.attachment = yield* Deferred.make<void>();
      yield* Deferred.done(previous, Exit.void);
      return stream;
    }
    const held = [...entries.values()].filter((entry) => entry._tag !== "Cancelled").length;
    if (held >= MAX_ENTRIES) return undefined;
    const stream: Live = {
      audio: yield* Queue.unbounded<Uint8Array, Cause.Done>(),
      lock: yield* Semaphore.make(1),
      receivedBytes: 0,
      finished: false,
      closed: yield* Deferred.make<boolean>(),
      attachment: yield* Deferred.make<void>(),
    };
    const result = yield* Deferred.make<TranscriptionUploadResult, TranscriptionError>();
    const fiber = yield* runLive(claims.uploadId, claims, stream, result).pipe(
      Effect.forkIn(serviceScope),
    );
    yield* Ref.update(entriesRef, (current) =>
      new Map(current).set(claims.uploadId, {
        _tag: "Transcribing",
        request: undefined,
        providerInstanceId: claims.providerInstanceId,
        work: { result, fiber },
        retainUntil: claims.expiresAt,
        live: stream,
      }),
    );
    return stream;
  });

  const attachStream: TranscriptionUploads["Service"]["attachStream"] = Effect.fn(
    "TranscriptionUploads.attachStream",
  )(function* (token, socket, revoked) {
    const writer = yield* socket.writer;
    const close = (code: number) => writer.write(new Socket.CloseEvent(code)).pipe(Effect.ignore);
    const payload = yield* verifyUploadToken(token).pipe(
      Effect.provideService(ServerSecretStore.ServerSecretStore, secretStore),
      Effect.orElseSucceed(() => null),
    );
    const claims =
      payload === null ? undefined : Option.getOrUndefined(decodeStreamClaims(payload));
    if (
      claims === undefined ||
      claims.bootId !== bootId ||
      claims.expiresAt <= (yield* Clock.currentTimeMillis)
    ) {
      return yield* close(TRANSCRIPTION_STREAM_CLOSED_CODE);
    }
    const live = yield* storeLock.withPermits(1)(attach(claims));
    if (live === undefined) return yield* close(TRANSCRIPTION_STREAM_CLOSED_CODE);
    const attachment = live.attachment;
    const receivedBytes = yield* live.lock.withPermits(1)(Effect.sync(() => live.receivedBytes));

    // Frames arrive every 100 ms for as long as someone talks; a span per frame adds nothing.
    const pump = Effect.fnUntraced(function* () {
      const reader = yield* socket.reader;
      yield* writer.write(encodeServerMessage({ type: "ready", receivedBytes }));
      while (true) {
        for (const frame of yield* reader.pull) {
          if (typeof frame !== "string") {
            yield* appendLive(live, frame);
          } else if (Option.isSome(decodeFinish(frame))) {
            yield* completeLive(live);
            yield* writer.write(encodeServerMessage({ type: "finished" }));
          }
        }
      }
    });
    const ended = yield* Effect.raceAll([
      pump().pipe(Effect.orElseSucceed(() => "disconnected" as const)),
      Deferred.await(live.closed).pipe(
        Effect.map((upload) => (upload ? ("upload" as const) : ("closed" as const))),
      ),
      Deferred.await(attachment).pipe(Effect.as("replaced" as const)),
      revoked(claims.sessionId).pipe(Effect.as("revoked" as const)),
    ]);
    if (ended === "revoked") {
      yield* cancel({ uploadId: claims.uploadId });
      return yield* close(1000);
    }
    if (ended === "upload") return yield* close(TRANSCRIPTION_STREAM_CLOSED_CODE);
    if (ended !== "disconnected") return yield* close(1000);
    if (!live.finished && live.attachment === attachment) {
      yield* expireDetached(claims.uploadId, live, attachment).pipe(Effect.forkIn(serviceScope));
    }
  });

  const run = (
    uploadId: string,
    claims: typeof UploadClaims.Type,
    audioPath: string,
    result: Result,
  ) => {
    const { request } = claims;
    return transcription
      .transcribeFile({
        path: audioPath,
        providerInstanceId: claims.providerInstanceId,
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
  };

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
    // Cancellations hold no work or outcome, so they don't use up capacity.
    const held = [...live.values()].filter((entry) => entry._tag !== "Cancelled").length;
    if (held >= MAX_ENTRIES) {
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
    const fiber = yield* run(uploadId, claims, audioPath, result).pipe(Effect.forkIn(serviceScope));
    yield* Ref.update(entriesRef, (entries) =>
      new Map(entries).set(uploadId, {
        _tag: "Transcribing",
        request,
        providerInstanceId: claims.providerInstanceId,
        work: { result, fiber },
        retainUntil: claims.expiresAt,
      }),
    );
    return Deferred.await(result);
  });

  const completeFromUpload = Effect.fn("TranscriptionUploads.completeFromUpload")(function* <E>(
    live: Live,
    body: Stream.Stream<Uint8Array, E>,
    sizeBytes: number,
  ) {
    const partPath = path.join(directory, `${yield* randomId}.part`);
    const audio = yield* writeUploadBody(body, sizeBytes, partPath).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
      Effect.flatMap((receivedBytes) =>
        receivedBytes === sizeBytes
          ? Effect.map(fileSystem.readFile(partPath), parseWav)
          : Effect.succeed(null),
      ),
      Effect.mapError((cause) => new TranscriptionError({ reason: "failed", cause })),
      Effect.ensuring(removeFile(partPath)),
    );
    if (audio === null) return yield* new TranscriptionError({ reason: "invalidAudio" });
    yield* completeLive(live, audio.pcm);
  });

  // Callers hold the store lock. A voice message made of a streamed dictation is sent once its
  // transcript exists, whether that is still to come or already here.
  const sendStreamed = Effect.fnUntraced(function* (
    uploadId: string,
    target: TranscriptionUploadSubmit,
  ) {
    const entry = (yield* Ref.get(entriesRef)).get(uploadId);
    if (entry === undefined || entry._tag === "Cancelled") return;
    if (entry.submit !== undefined) {
      return sameTarget(entry.submit, target)
        ? undefined
        : new TranscriptionError({ reason: "requestConflict" });
    }
    if (entry._tag === "Transcribing") {
      yield* Ref.update(entriesRef, (entries) =>
        new Map(entries).set(uploadId, { ...entry, submit: target }),
      );
      return;
    }
    if (entry._tag !== "Settled" || !Exit.isSuccess(entry.outcome)) return;
    const { text } = entry.outcome.value;
    const result = yield* Deferred.make<TranscriptionUploadResult, TranscriptionError>();
    const fiber = yield* dispatchTranscript(target, text).pipe(
      Effect.exit,
      Effect.flatMap((exit) => settle(uploadId, result, exit)),
      Effect.forkIn(serviceScope),
    );
    yield* Ref.update(entriesRef, (entries) =>
      new Map(entries).set(uploadId, {
        _tag: "Submitting",
        request: undefined,
        providerInstanceId: entry.providerInstanceId,
        work: { result, fiber },
        retainUntil: entry.retainUntil,
        submit: target,
      }),
    );
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
    if (known !== undefined) {
      const live = known._tag === "Transcribing" ? known.live : undefined;
      if (live !== undefined && !live.finished) {
        // The stream stopped short; the recording fills in what it missed.
        if (body === undefined) return yield* new TranscriptionError({ reason: "uploadExpired" });
        yield* completeFromUpload(live, body, claims.request.sizeBytes);
      } else if (body !== undefined) {
        // A client sending the audio again can't read the answer until its body is taken, so
        // waiting on the work with the body unread would stall that upload.
        yield* Stream.runDrain(body).pipe(Effect.ignore);
      }
      const target = claims.request.submit;
      if (target !== undefined && known._tag !== "Cancelled" && known.request === undefined) {
        const conflict = yield* storeLock.withPermits(1)(sendStreamed(uploadId, target));
        if (conflict !== undefined) return yield* conflict;
      }
      const current = (yield* storeLock.withPermits(1)(liveEntries)).get(uploadId) ?? known;
      return yield* joinEntry(current, request);
    }
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
    const uploadId = input.submit?.commandId ?? input.uploadId ?? (yield* randomId);
    const expiresAt = (yield* Clock.currentTimeMillis) + ATTACHMENT_UPLOAD_URL_TTL_MS;
    const known = yield* storeLock.withPermits(1)(
      Effect.flatMap(liveEntries, (live) => {
        const entry = live.get(uploadId);
        if (entry === undefined || entry.retainUntil >= expiresAt) return Effect.succeed(entry);
        return Ref.set(
          entriesRef,
          new Map(live).set(uploadId, { ...entry, retainUntil: expiresAt }),
        ).pipe(Effect.as(entry));
      }),
    );
    // Recovering an upload's recorded outcome needs no usable provider; new work does.
    const providerInstanceId =
      known !== undefined && "providerInstanceId" in known
        ? known.providerInstanceId
        : yield* transcription.checkSource(input);
    const token = yield* signUploadToken(
      encodeUploadClaims({
        version: 1,
        kind: "transcription-upload",
        bootId,
        uploadId,
        expiresAt,
        providerInstanceId,
        request: input,
      }),
    ).pipe(Effect.provideService(ServerSecretStore.ServerSecretStore, secretStore));
    return { uploadId, relativeUrl: `${TRANSCRIPTION_UPLOAD_ROUTE_PREFIX}/${token}`, expiresAt };
  });

  const prepareStream: TranscriptionUploads["Service"]["prepareStream"] = Effect.fn(
    "TranscriptionUploads.prepareStream",
  )(function* (input, sessionId) {
    const expiresAt = (yield* Clock.currentTimeMillis) + ATTACHMENT_UPLOAD_URL_TTL_MS;
    const known = (yield* storeLock.withPermits(1)(liveEntries)).get(input.uploadId);
    const providerInstanceId =
      known !== undefined && "providerInstanceId" in known
        ? known.providerInstanceId
        : yield* transcription.checkSource(input);
    const token = yield* signUploadToken(
      encodeStreamClaims({
        version: 1,
        kind: "transcription-stream",
        bootId,
        uploadId: input.uploadId,
        expiresAt,
        providerInstanceId,
        sessionId,
        request: input,
      }),
    ).pipe(Effect.provideService(ServerSecretStore.ServerSecretStore, secretStore));
    return {
      uploadId: input.uploadId,
      relativeUrl: `${TRANSCRIPTION_STREAM_ROUTE_PREFIX}/${token}`,
      expiresAt,
    };
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
        if (entry?._tag === "Submitting" || entry?._tag === "Settled") {
          return { outcome: "tooLate" } as const;
        }
        // Recorded even when nothing is known yet, so an upload still on its way can't start.
        const retainUntil = Math.max(entry?.retainUntil ?? 0, now + OUTCOME_TTL_MS);
        yield* Ref.set(entriesRef, new Map(live).set(uploadId, { _tag: "Cancelled", retainUntil }));
        return {
          outcome: "cancelled",
          stopped: entry?._tag === "Transcribing" ? entry : undefined,
        } as const;
      }),
    );
    if (decision.outcome === "cancelled" && decision.stopped !== undefined) {
      yield* Fiber.interrupt(decision.stopped.work.fiber);
      yield* Deferred.done(decision.stopped.work.result, cancelled);
      if (decision.stopped.live) yield* closeLive(decision.stopped.live, false);
    }
    return { outcome: decision.outcome };
  }, Effect.uninterruptible);

  yield* Effect.sleep(PRUNE_INTERVAL).pipe(
    Effect.andThen(storeLock.withPermits(1)(liveEntries)),
    Effect.forever,
    Effect.forkIn(serviceScope),
  );

  return TranscriptionUploads.of({ prepare, receive, cancel, prepareStream, attachStream });
});

export const layer = Layer.effect(TranscriptionUploads, make);
