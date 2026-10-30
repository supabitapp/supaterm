import {
  CommandId,
  SecretRequestError,
  type SecretRequestAnswerInput,
  type ThreadId,
} from "@supaterm/contracts";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- Effect's Crypto has no createHmac.
import * as NodeCrypto from "node:crypto";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Predicate from "effect/Predicate";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";

const SECRET_TTL_MS = 24 * 60 * 60 * 1000;
const STORE_NAME_PATTERN = /^(secret-request-[0-9a-f]{32})\.bin$/;
const FILE_NAME_PATTERN = /^[0-9a-f]{32}(\.partial)?$/;
const StoredSecret = Schema.fromJsonString(
  Schema.Struct({ projectId: Schema.String, value: Schema.String, savedAt: Schema.Number }),
);
const encodeStored = Schema.encodeEffect(StoredSecret);
const decodeStored = Schema.decodeUnknownOption(StoredSecret);

const isAlreadyExists = (error: ServerSecretStore.SecretStoreError) =>
  "cause" in error &&
  Predicate.isTagged(error.cause, "PlatformError") &&
  Predicate.hasProperty(error.cause, "reason") &&
  Predicate.isTagged(error.cause.reason, "AlreadyExists");

export class SecretRequests extends Context.Service<
  SecretRequests,
  {
    readonly answer: (input: SecretRequestAnswerInput) => Effect.Effect<void, SecretRequestError>;
    readonly saveToFile: (input: {
      readonly threadId: ThreadId;
      readonly turnItemId: string;
    }) => Effect.Effect<string, SecretRequestError>;
  }
>()("supaterm/secrets/SecretRequests") {}

const make = Effect.gen(function* () {
  const store = yield* ServerSecretStore.ServerSecretStore;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const threadManagement = yield* ThreadManagementService.ThreadManagementService;
  const filesDir = store.directory === undefined ? undefined : path.join(store.directory, "files");
  const salt = yield* store.getOrCreateRandom("secret-request-salt", 32).pipe(Effect.orDie);
  const lock = yield* Semaphore.make(1);
  const keyFor = (threadId: ThreadId, turnItemId: string) =>
    NodeCrypto.createHmac("sha256", salt)
      .update(`${threadId}\u0000${turnItemId}`)
      .digest("hex")
      .slice(0, 32);
  const storeName = (key: string) => `secret-request-${key}`;

  const removeStored = Effect.fn("SecretRequests.removeStored")(function* (name: string) {
    return yield* store.remove(name).pipe(
      Effect.as(true),
      Effect.catch(() =>
        Effect.logWarning("Could not delete a secret request value").pipe(Effect.as(false)),
      ),
    );
  });

  const answer: SecretRequests["Service"]["answer"] = Effect.fn("SecretRequests.answer")(function* (
    input,
  ) {
    yield* Effect.annotateCurrentSpan({
      "orchestration_v2.thread_id": input.threadId,
      "secret_request.answer": input.answer.type,
    });
    const records = yield* threadManagement
      .getThreadRecords(input.threadId, ["runs", "turnItems"], {
        turnItemTypes: ["secret_request"],
        messageRoles: [],
      })
      .pipe(Effect.mapError((cause) => new SecretRequestError({ reason: "load_failed", cause })));
    const item = records.turnItems.find((candidate) => candidate.id === input.turnItemId);
    if (
      item?.type !== "secret_request" ||
      item.threadId !== input.threadId ||
      item.runId === null ||
      item.nodeId === null
    ) {
      return yield* new SecretRequestError({ reason: "not_found" });
    }
    if (item.secretStatus !== "pending")
      return yield* new SecretRequestError({ reason: "already_answered" });
    if (item.delivery !== "file")
      return yield* new SecretRequestError({ reason: "not_a_file_request" });
    const { runId, nodeId } = item;
    const run = records.runs.find((candidate) => candidate.id === runId);
    if (
      run === undefined ||
      run.rootNodeId !== nodeId ||
      run.status === "queued" ||
      ThreadManagementService.isTerminalRunStatus(run.status)
    ) {
      return yield* new SecretRequestError({ reason: "agent_stopped" });
    }
    const name = storeName(keyFor(input.threadId, item.id));
    yield* Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        if (input.answer.type === "save") {
          const encoded = yield* encodeStored({
            projectId: records.thread.projectId,
            value: input.answer.secret,
            savedAt: yield* Clock.currentTimeMillis,
          }).pipe(Effect.orDie);
          yield* store.create(name, new TextEncoder().encode(encoded)).pipe(
            Effect.catchIf(isAlreadyExists, () => Effect.void),
            Effect.mapError((cause) => new SecretRequestError({ reason: "store_failed", cause })),
          );
        }
        const secretStatus = input.answer.type === "save" ? "saved" : "declined";
        const dispatched = yield* restore(
          threadManagement.dispatch({
            type: "secret_request.record",
            commandId: CommandId.make(`secret-request:${item.id}:${secretStatus}`),
            threadId: input.threadId,
            runId,
            nodeId,
            turnItemId: item.id,
            label: item.label,
            reason: item.reason,
            ...(item.placeholder === undefined ? {} : { placeholder: item.placeholder }),
            delivery: "file",
            secretStatus,
          }),
        ).pipe(Effect.exit);
        const recorded = yield* threadManagement
          .getThreadRecords(input.threadId, ["turnItems"], {
            turnItemTypes: ["secret_request"],
            messageRoles: [],
          })
          .pipe(
            Effect.mapError((cause) => new SecretRequestError({ reason: "record_failed", cause })),
          );
        const card = recorded.turnItems.find((candidate) => candidate.id === item.id);
        if (card?.type === "secret_request" && card.secretStatus === secretStatus) return;
        if (input.answer.type === "save") yield* removeStored(name);
        if (dispatched._tag === "Failure") {
          return yield* new SecretRequestError({
            reason: "record_failed",
            cause: dispatched.cause,
          });
        }
        return yield* new SecretRequestError({ reason: "agent_stopped" });
      }),
    );
  }, lock.withPermits(1));

  const saveToFile: SecretRequests["Service"]["saveToFile"] = Effect.fn(
    "SecretRequests.saveToFile",
  )(function* (input) {
    const records = yield* threadManagement
      .getThreadRecords(input.threadId, ["turnItems"], {
        turnItemTypes: ["secret_request"],
        messageRoles: [],
      })
      .pipe(Effect.mapError((cause) => new SecretRequestError({ reason: "load_failed", cause })));
    const item = records.turnItems.find((candidate) => candidate.id === input.turnItemId);
    if (
      item?.type !== "secret_request" ||
      item.threadId !== input.threadId ||
      item.secretStatus !== "saved" ||
      item.delivery !== "file"
    ) {
      return yield* new SecretRequestError({ reason: "not_a_file_request" });
    }
    if (filesDir === undefined) return yield* new SecretRequestError({ reason: "store_failed" });
    const key = keyFor(input.threadId, item.id);
    const name = storeName(key);
    const file = path.join(filesDir, key);
    if (
      !(yield* fileSystem
        .exists(file)
        .pipe(Effect.mapError((cause) => new SecretRequestError({ reason: "read_failed", cause }))))
    ) {
      const stored = yield* store
        .get(name)
        .pipe(Effect.mapError((cause) => new SecretRequestError({ reason: "read_failed", cause })));
      const decoded = Option.flatMap(stored, (bytes) =>
        decodeStored(new TextDecoder().decode(bytes)),
      );
      if (Option.isNone(decoded) || decoded.value.projectId !== records.thread.projectId) {
        return yield* new SecretRequestError({ reason: "ref_unavailable" });
      }
      if ((yield* Clock.currentTimeMillis) - decoded.value.savedAt > SECRET_TTL_MS) {
        yield* removeStored(name);
        return yield* new SecretRequestError({ reason: "ref_expired" });
      }
      const partial = `${file}.partial`;
      yield* Effect.gen(function* () {
        yield* fileSystem.makeDirectory(filesDir, { recursive: true, mode: 0o700 });
        yield* fileSystem.chmod(filesDir, 0o700);
        yield* fileSystem.remove(partial, { force: true });
        yield* Effect.scoped(
          Effect.gen(function* () {
            const target = yield* fileSystem.open(partial, { flag: "wx", mode: 0o600 });
            yield* target.writeAll(new TextEncoder().encode(decoded.value.value));
            yield* target.sync;
          }),
        );
        yield* fileSystem.rename(partial, file);
      }).pipe(
        Effect.ensuring(fileSystem.remove(partial, { force: true }).pipe(Effect.ignore)),
        Effect.mapError((cause) => new SecretRequestError({ reason: "store_failed", cause })),
      );
    }
    if (!(yield* removeStored(name)))
      return yield* new SecretRequestError({ reason: "consume_failed" });
    return file;
  }, lock.withPermits(1));

  const sweep = Effect.fn("SecretRequests.sweep")(
    function* () {
      if (store.directory === undefined) return;
      const now = yield* Clock.currentTimeMillis;
      for (const file of yield* fileSystem.readDirectory(store.directory)) {
        const name = STORE_NAME_PATTERN.exec(file)?.[1];
        if (name === undefined) continue;
        const stored = yield* store.get(name);
        const decoded = Option.flatMap(stored, (bytes) =>
          decodeStored(new TextDecoder().decode(bytes)),
        );
        if (Option.isSome(decoded) && now - decoded.value.savedAt <= SECRET_TTL_MS) continue;
        yield* removeStored(name);
      }
      if (filesDir === undefined || !(yield* fileSystem.exists(filesDir))) return;
      for (const name of yield* fileSystem.readDirectory(filesDir)) {
        if (!FILE_NAME_PATTERN.test(name)) continue;
        const file = path.join(filesDir, name);
        const { mtime } = yield* fileSystem.stat(file);
        if (Option.exists(mtime, (time) => now - time.getTime() <= SECRET_TTL_MS)) continue;
        yield* fileSystem.remove(file);
      }
    },
    lock.withPermits(1),
    Effect.catch(() => Effect.logWarning("Could not sweep expired secret requests")),
  );
  yield* sweep();
  yield* sweep().pipe(
    Effect.delay("1 hour"),
    Effect.repeat(Schedule.spaced("1 hour")),
    Effect.forkScoped,
  );
  return SecretRequests.of({ answer, saveToFile });
});

export const layer = Layer.effect(SecretRequests, make);
