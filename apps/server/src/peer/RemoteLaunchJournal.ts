import {
  EnvironmentId,
  ModelSelection,
  NodeId,
  OrchestrationV2RunStatus,
  ProjectId,
  ProviderInstanceId,
  ProviderInteractionMode,
  RunId,
  RuntimeMode,
  ThreadId,
} from "@supaterm/contracts";
import * as KeyedLock from "@supaterm/shared/KeyedLock";
import * as HostProcess from "@supaterm/shared/HostProcess";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ServerConfig from "../config.ts";

const LaunchResult = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  modelSelection: ModelSelection,
  runId: Schema.NullOr(RunId),
  status: Schema.NullOr(OrchestrationV2RunStatus),
});

export const RemoteLaunchIntent = Schema.Struct({
  id: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  label: Schema.String,
  parentThreadId: ThreadId,
  parentRunId: RunId,
  parentNodeId: NodeId,
  providerInstanceId: ProviderInstanceId,
  requestNamespace: Schema.String,
  targetEnvironmentId: EnvironmentId,
  credentialId: Schema.String,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  launch: Schema.Struct({
    projectId: ProjectId,
    title: Schema.String,
    modelSelection: ModelSelection,
    runtimeMode: Schema.optional(RuntimeMode),
    interactionMode: Schema.optional(ProviderInteractionMode),
    message: Schema.String,
    clientRequestId: Schema.String,
    delegatedFrom: Schema.Struct({
      environmentId: EnvironmentId,
      threadId: ThreadId,
      title: Schema.String,
    }),
  }),
  task: Schema.String,
  title: Schema.optional(Schema.String),
  completionWake: Schema.Literals(["settled_only", "always"]),
  remote: Schema.NullOr(LaunchResult),
  taskId: Schema.NullOr(NodeId),
});
export type RemoteLaunchIntent = typeof RemoteLaunchIntent.Type;

export class RemoteLaunchJournalError extends Schema.TaggedError<RemoteLaunchJournalError>()(
  "RemoteLaunchJournalError",
  { operation: Schema.Literals(["read", "write", "remove"]), cause: Schema.Defect() },
) {
  override get message() {
    return "The remote launch recovery record could not be persisted or read.";
  }
}

export class RemoteLaunchJournal extends Context.Service<
  RemoteLaunchJournal,
  {
    readonly prepare: (
      intent: RemoteLaunchIntent,
    ) => Effect.Effect<RemoteLaunchIntent, RemoteLaunchJournalError>;
    readonly recordLaunch: (
      intent: RemoteLaunchIntent,
      remote: typeof LaunchResult.Type,
    ) => Effect.Effect<RemoteLaunchIntent, RemoteLaunchJournalError>;
    readonly pending: Effect.Effect<ReadonlyArray<RemoteLaunchIntent>, RemoteLaunchJournalError>;
    readonly complete: (
      intent: RemoteLaunchIntent,
      taskId: NodeId,
    ) => Effect.Effect<void, RemoteLaunchJournalError>;
    readonly remove: (id: string) => Effect.Effect<void, RemoteLaunchJournalError>;
  }
>()("supaterm/peer/RemoteLaunchJournal") {}

const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(RemoteLaunchIntent));
const encode = Schema.encodeEffect(Schema.fromJsonString(RemoteLaunchIntent));

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const config = yield* ServerConfig.ServerConfig;
  const platform = yield* HostProcess.Platform;
  const directory = path.join(config.stateDir, "remote-launches");
  const locks = yield* KeyedLock.make<string>();
  const filename = (id: string) => path.join(directory, `${id}.json`);
  const read = (id: string) => fs.readFileString(filename(id)).pipe(Effect.flatMap(decode));
  const syncDirectory =
    platform === "win32"
      ? Effect.void
      : Effect.scoped(fs.open(directory, { flag: "r" }).pipe(Effect.flatMap((file) => file.sync)));

  const write = Effect.fn("RemoteLaunchJournal.write")(function* (
    intent: RemoteLaunchIntent,
    exclusive: boolean,
  ) {
    const json = yield* encode(intent);
    yield* fs.makeDirectory(directory, { recursive: true, mode: 0o700 });
    const temporary = path.join(directory, `${intent.id}.${yield* crypto.randomUUIDv4()}.tmp`);
    yield* Effect.acquireUseRelease(
      Effect.succeed(temporary),
      (temporary) =>
        Effect.gen(function* () {
          yield* Effect.scoped(
            Effect.gen(function* () {
              const file = yield* fs.open(temporary, { flag: "wx", mode: 0o600 });
              yield* file.writeAll(new TextEncoder().encode(json));
              yield* file.sync;
            }),
          );
          if (exclusive) yield* fs.link(temporary, filename(intent.id));
          else yield* fs.rename(temporary, filename(intent.id));
          yield* syncDirectory;
        }),
      (temporary) => fs.remove(temporary, { force: true }).pipe(Effect.ignore),
    );
  });

  const prepare: RemoteLaunchJournal["Service"]["prepare"] = Effect.fn(
    "RemoteLaunchJournal.prepare",
  )(
    (intent) =>
      locks.withLock(
        intent.id,
        Effect.gen(function* () {
          if (yield* fs.exists(filename(intent.id))) return yield* read(intent.id);
          yield* write(intent, true).pipe(
            Effect.catchIf(
              (error) => error._tag === "PlatformError" && error.reason._tag === "AlreadyExists",
              () => Effect.void,
            ),
          );
          return yield* read(intent.id);
        }),
      ),
    Effect.mapError((cause) => new RemoteLaunchJournalError({ operation: "write", cause })),
  );

  const recordLaunch: RemoteLaunchJournal["Service"]["recordLaunch"] = Effect.fn(
    "RemoteLaunchJournal.recordLaunch",
  )(
    (intent, remote) =>
      locks.withLock(
        intent.id,
        Effect.gen(function* () {
          const saved = yield* read(intent.id);
          if (saved.remote !== null) return saved;
          const next = { ...saved, remote };
          yield* write(next, false);
          return next;
        }),
      ),
    Effect.mapError((cause) => new RemoteLaunchJournalError({ operation: "write", cause })),
  );

  const pending = Effect.gen(function* () {
    if (!(yield* fs.exists(directory))) return [];
    const files = yield* fs.readDirectory(directory);
    const entries = yield* Effect.forEach(
      files.filter((name) => /^[a-f0-9]{64}\.json$/.test(name)),
      (name) => fs.readFileString(path.join(directory, name)).pipe(Effect.flatMap(decode)),
    );
    return entries.filter((entry) => entry.taskId === null);
  }).pipe(Effect.mapError((cause) => new RemoteLaunchJournalError({ operation: "read", cause })));

  const complete: RemoteLaunchJournal["Service"]["complete"] = Effect.fn(
    "RemoteLaunchJournal.complete",
  )(
    (intent, taskId) => locks.withLock(intent.id, write({ ...intent, taskId }, false)),
    Effect.mapError((cause) => new RemoteLaunchJournalError({ operation: "write", cause })),
  );

  const remove: RemoteLaunchJournal["Service"]["remove"] = Effect.fn("RemoteLaunchJournal.remove")(
    (id) =>
      locks.withLock(
        id,
        fs.remove(filename(id), { force: true }).pipe(Effect.andThen(syncDirectory)),
      ),
    Effect.mapError((cause) => new RemoteLaunchJournalError({ operation: "remove", cause })),
  );
  return RemoteLaunchJournal.of({ prepare, recordLaunch, pending, complete, remove });
});

export const layer = Layer.effect(RemoteLaunchJournal, make);
