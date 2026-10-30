import * as HostProcess from "@supaterm/shared/HostProcess";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  CommandId,
  SecretRequestAnswerInput,
  ThreadId,
  TurnItemId,
  type OrchestrationV2ServerCommand,
} from "@supaterm/contracts";
import * as Deferred from "effect/Deferred";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";
import * as Tracer from "effect/Tracer";

import { secretRequestAnswerInput } from "../../../../packages/client-runtime/src/secretRequest.ts";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as SecretRequests from "./SecretRequests.ts";

const threadId = ThreadId.make("thread-private");
const turnItemId = TurnItemId.make("private-request-1");
const secret = "disposable-private-token'$(id)";
const save = { threadId, turnItemId, answer: { type: "save" as const, secret } };
const decodeAnswer = Schema.decodeSync(SecretRequestAnswerInput);
const encodeAnswer = Schema.encodeSync(SecretRequestAnswerInput);
const decline = { threadId, turnItemId, answer: { type: "decline" as const } };

const withService = <A, E>(
  body: (fixture: {
    service: SecretRequests.SecretRequests["Service"];
    store: ServerSecretStore.ServerSecretStore["Service"];
    fs: FileSystem.FileSystem;
    directory: string;
    dispatched: Array<OrchestrationV2ServerCommand>;
    state: {
      secretStatus: "pending" | "saved" | "declined" | "cancelled";
      runStatus: string;
      rootNodeId: string;
      delivery: "file" | undefined;
      projectId: string;
      recordFailures: number;
      lostAck: boolean;
      closeBeforeRecord: boolean;
      removeFails: boolean;
      loadFails: boolean;
      writeFails: boolean;
    };
    restart: () => Effect.Effect<void>;
    removedFile: Deferred.Deferred<string>;
  }) => Effect.Effect<A, E>,
  options: { threadId?: ThreadId; directory?: string } = {},
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const base =
        options.directory ?? (yield* fs.makeTempDirectoryScoped({ prefix: "supaterm-private-" }));
      const removedFile = yield* Deferred.make<string>();
      const requestThreadId = options.threadId ?? threadId;
      const dispatched: Array<OrchestrationV2ServerCommand> = [];
      const state = {
        secretStatus: "pending" as "pending" | "saved" | "declined" | "cancelled",
        runStatus: "running",
        rootNodeId: "node-root",
        delivery: "file" as "file" | undefined,
        projectId: "project-private",
        recordFailures: 0,
        lostAck: false,
        closeBeforeRecord: false,
        removeFails: false,
        loadFails: false,
        writeFails: false,
      };
      const filesystem = Layer.succeed(FileSystem.FileSystem, {
        ...fs,
        open: (file, options) =>
          state.writeFails && String(file).endsWith(".partial")
            ? Effect.fail(
                PlatformError.systemError({
                  _tag: "PermissionDenied",
                  module: "FileSystem",
                  method: "open",
                }),
              )
            : fs.open(file, options),
        remove: (file, options) =>
          fs
            .remove(file, options)
            .pipe(
              Effect.tap(() =>
                path.dirname(file).endsWith("/files") && !String(file).endsWith(".partial")
                  ? Deferred.succeed(removedFile, String(file))
                  : Effect.void,
              ),
            ),
      });
      const store = yield* ServerSecretStore.make.pipe(
        Effect.provide(Layer.merge(ServerConfig.layerTest(process.cwd(), base), filesystem)),
      );
      const directory = store.directory!;
      const dependencies = Layer.mergeAll(
        filesystem,
        Layer.succeed(Path.Path, path),
        Layer.succeed(ServerSecretStore.ServerSecretStore, {
          ...store,
          remove: (name) =>
            state.removeFails
              ? Effect.fail(
                  new ServerSecretStore.SecretStoreRemoveError({
                    resource: name,
                    cause: new Error("unavailable"),
                  }),
                )
              : store.remove(name),
        }),
        Layer.mock(ThreadManagementService.ThreadManagementService)({
          getThreadRecords: () =>
            state.loadFails
              ? Effect.fail(new Error("unavailable") as never)
              : Effect.succeed({
                  thread: { projectId: state.projectId },
                  runs: [{ id: "run-1", rootNodeId: state.rootNodeId, status: state.runStatus }],
                  turnItems: [
                    {
                      id: turnItemId,
                      threadId: requestThreadId,
                      runId: "run-1",
                      nodeId: "node-root",
                      type: "secret_request",
                      label: "CLI token",
                      reason: "Used by the requested CLI.",
                      delivery: state.delivery,
                      secretStatus: state.secretStatus,
                    },
                  ],
                } as never),
          dispatch: (command) =>
            Effect.gen(function* () {
              if (state.recordFailures > 0) {
                state.recordFailures -= 1;
                return yield* Effect.fail(new Error("record unavailable") as never);
              }
              dispatched.push(command);
              if (command.type === "secret_request.record" && state.secretStatus === "pending") {
                state.secretStatus = state.closeBeforeRecord ? "cancelled" : command.secretStatus;
              }
              if (state.lostAck)
                return yield* Effect.fail(new Error("lost acknowledgement") as never);
              return { commandId: CommandId.make("recorded") } as never;
            }),
        }),
      );
      const layer = SecretRequests.layer.pipe(Layer.provide(dependencies));
      return yield* Effect.gen(function* () {
        const service = yield* SecretRequests.SecretRequests;
        return yield* body({
          service,
          store,
          fs,
          directory,
          dispatched,
          state,
          removedFile,
          restart: () => Effect.scoped(Effect.void.pipe(Effect.provide(Layer.fresh(layer)))),
        });
      }).pipe(Effect.provide(layer));
    }),
  ).pipe(Effect.provide(NodeServices.layer));

const requestFiles = (fs: FileSystem.FileSystem, directory: string) =>
  fs
    .readDirectory(directory)
    .pipe(
      Effect.map((files) =>
        files.filter((name) => /^secret-request-[0-9a-f]{32}\.bin$/.test(name)),
      ),
    );

it.effect(
  "file delivery stores privately, records only metadata, and retries the same readable file",
  () =>
    withService(({ service, fs, directory, dispatched }) =>
      Effect.gen(function* () {
        yield* service.answer(save);
        const stored = yield* requestFiles(fs, directory);
        assert.lengthOf(stored, 1);
        assert.include(yield* fs.readFileString(`${directory}/${stored[0]}`), secret);
        if ((yield* HostProcess.Platform) !== "win32") {
          assert.equal((yield* fs.stat(`${directory}/${stored[0]}`)).mode & 0o777, 0o600);
        }
        const file = yield* service.saveToFile({ threadId, turnItemId });
        assert.equal(yield* fs.readFileString(file), secret);
        assert.equal(yield* fs.readFileString(file), secret);
        assert.deepEqual(yield* requestFiles(fs, directory), []);
        assert.equal(yield* service.saveToFile({ threadId, turnItemId }), file);
        assert.notInclude(JSON.stringify(dispatched), secret);
        assert.include(dispatched[0] as object, { secretStatus: "saved", delivery: "file" });
        if ((yield* HostProcess.Platform) !== "win32") {
          assert.equal((yield* fs.stat(file)).mode & 0o777, 0o600);
          assert.equal((yield* fs.stat(`${directory}/files`)).mode & 0o777, 0o700);
          assert.equal((yield* fs.stat(directory)).mode & 0o777, 0o700);
        }
      }),
    ),
);

it.effect(
  "concurrent saves keep the first accepted value and concurrent delivery returns one path",
  () =>
    withService(({ service, fs, dispatched }) =>
      Effect.gen(function* () {
        const answers = yield* Effect.forEach(
          [save, { ...save, answer: { type: "save" as const, secret: "second-value" } }],
          (input) => Effect.result(service.answer(input)),
          { concurrency: "unbounded" },
        );
        assert.deepEqual(answers.map((answer) => answer._tag).toSorted(), ["Failure", "Success"]);
        assert.lengthOf(dispatched, 1);
        const files = yield* Effect.forEach(
          [1, 2],
          () => service.saveToFile({ threadId, turnItemId }),
          { concurrency: "unbounded" },
        );
        assert.equal(files[0], files[1]);
        assert.equal(yield* fs.readFileString(files[0]!), secret);
      }),
    ),
);

it.effect("a decline racing a save cannot leave an unclaimed stored value", () =>
  withService(({ service, fs, directory, dispatched }) =>
    Effect.gen(function* () {
      const answers = yield* Effect.forEach(
        [decline, save],
        (input) => Effect.result(service.answer(input)),
        { concurrency: "unbounded" },
      );
      assert.deepEqual(answers.map((answer) => answer._tag).toSorted(), ["Failure", "Success"]);
      assert.lengthOf(dispatched, 1);
      assert.include(dispatched[0] as object, { secretStatus: "declined" });
      assert.deepEqual(yield* requestFiles(fs, directory), []);
      assert.equal(
        (yield* service.saveToFile({ threadId, turnItemId }).pipe(Effect.flip)).reason,
        "not_a_file_request",
      );
    }),
  ),
);

it.effect("a failed record can retry without retaining the rejected value", () =>
  withService(({ service, fs, directory, state }) =>
    Effect.gen(function* () {
      state.recordFailures = 1;
      assert.equal((yield* service.answer(save).pipe(Effect.flip)).reason, "record_failed");
      assert.deepEqual(yield* requestFiles(fs, directory), []);
      yield* service.answer({ ...save, answer: { type: "save", secret: "replacement" } });
      const file = yield* service.saveToFile({ threadId, turnItemId });
      assert.equal(yield* fs.readFileString(file), "replacement");
    }),
  ),
);

it.effect("a committed record with a lost acknowledgement keeps the delivered value", () =>
  withService(({ service, fs, state }) =>
    Effect.gen(function* () {
      state.lostAck = true;
      yield* service.answer(save);
      const file = yield* service.saveToFile({ threadId, turnItemId });
      assert.equal(yield* fs.readFileString(file), secret);
    }),
  ),
);

it.effect(
  "closed and stopped requests reject late saves and clear a save that loses to cancellation",
  () =>
    withService(({ service, fs, directory, state }) =>
      Effect.gen(function* () {
        state.runStatus = "completed";
        assert.equal((yield* service.answer(save).pipe(Effect.flip)).reason, "agent_stopped");
        state.runStatus = "running";
        state.closeBeforeRecord = true;
        assert.equal((yield* service.answer(save).pipe(Effect.flip)).reason, "agent_stopped");
        assert.deepEqual(yield* requestFiles(fs, directory), []);
        assert.equal((yield* service.answer(save).pipe(Effect.flip)).reason, "already_answered");
      }),
    ),
);

it.effect("failed file writes preserve the stored value for retry and remove partial files", () =>
  withService(({ service, fs, directory, state }) =>
    Effect.gen(function* () {
      yield* service.answer(save);
      state.writeFails = true;
      assert.equal(
        (yield* service.saveToFile({ threadId, turnItemId }).pipe(Effect.flip)).reason,
        "store_failed",
      );
      assert.lengthOf(yield* requestFiles(fs, directory), 1);
      assert.deepEqual(yield* fs.readDirectory(`${directory}/files`), []);
      state.writeFails = false;
      const file = yield* service.saveToFile({ threadId, turnItemId });
      assert.equal(yield* fs.readFileString(file), secret);
    }),
  ),
);

it.effect("delivery waits for stored-copy removal and recovers the original path on retry", () =>
  withService(({ service, fs, directory, state }) =>
    Effect.gen(function* () {
      yield* service.answer(save);
      state.removeFails = true;
      assert.equal(
        (yield* service.saveToFile({ threadId, turnItemId }).pipe(Effect.flip)).reason,
        "consume_failed",
      );
      const [name] = yield* fs.readDirectory(`${directory}/files`);
      assert.equal(
        (yield* service.saveToFile({ threadId, turnItemId }).pipe(Effect.flip)).reason,
        "consume_failed",
      );
      state.removeFails = false;
      assert.equal(
        yield* service.saveToFile({ threadId, turnItemId }),
        `${directory}/files/${name}`,
      );
    }),
  ),
);

it.effect(
  "expired values cannot be delivered, and startup removes abandoned values and partial files",
  () =>
    withService(({ service, store, fs, directory, restart }) =>
      Effect.gen(function* () {
        yield* service.answer(save);
        const [name] = yield* requestFiles(fs, directory);
        const stored = Option.getOrThrow(yield* store.get(name!.slice(0, -4)));
        const value = JSON.parse(new TextDecoder().decode(stored)) as {
          projectId: string;
          value: string;
          savedAt: number;
        };
        yield* store.set(
          name!.slice(0, -4),
          new TextEncoder().encode(JSON.stringify({ ...value, savedAt: -25 * 60 * 60 * 1000 })),
        );
        assert.equal(
          (yield* service.saveToFile({ threadId, turnItemId }).pipe(Effect.flip)).reason,
          "ref_expired",
        );
        yield* fs.makeDirectory(`${directory}/files`, { recursive: true });
        const partial = `${directory}/files/${"a".repeat(32)}.partial`;
        yield* fs.writeFileString(partial, "partial-value");
        const epoch = DateTime.toDateUtc(DateTime.makeUnsafe(0));
        yield* fs.utimes(partial, epoch, epoch);
        yield* TestClock.adjust("25 hours");
        yield* store.create(
          `secret-request-${"b".repeat(32)}`,
          new TextEncoder().encode(
            JSON.stringify({ projectId: "project-private", value: "abandoned", savedAt: 0 }),
          ),
        );
        yield* restart();
        assert.isFalse(yield* fs.exists(partial));
        assert.deepEqual(yield* requestFiles(fs, directory), []);
      }),
    ),
);

it.effect("hourly cleanup removes expired delivered files using a completion signal", () =>
  withService(({ service, fs, removedFile }) =>
    Effect.gen(function* () {
      yield* service.answer(save);
      const file = yield* service.saveToFile({ threadId, turnItemId });
      const expired = DateTime.toDateUtc(DateTime.makeUnsafe(-25 * 60 * 60 * 1000));
      yield* fs.utimes(file, expired, expired);
      yield* TestClock.adjust("1 hour");
      assert.equal(yield* Deferred.await(removedFile), file);
      assert.isFalse(yield* fs.exists(file));
    }),
  ),
);

it.effect("file mode is required and values cannot cross projects", () =>
  withService(({ service, fs, directory, state }) =>
    Effect.gen(function* () {
      state.delivery = undefined;
      assert.equal((yield* service.answer(save).pipe(Effect.flip)).reason, "not_a_file_request");
      state.secretStatus = "saved";
      assert.equal(
        (yield* service.saveToFile({ threadId, turnItemId }).pipe(Effect.flip)).reason,
        "not_a_file_request",
      );
      state.secretStatus = "pending";
      state.delivery = "file";
      yield* service.answer(save);
      state.projectId = "another-project";
      assert.equal(
        (yield* service.saveToFile({ threadId, turnItemId }).pipe(Effect.flip)).reason,
        "ref_unavailable",
      );
      assert.lengthOf(yield* requestFiles(fs, directory), 1);
    }),
  ),
);

it.effect("stable hashed paths handle long delegated thread identifiers", () => {
  const delegated = ThreadId.make(`thread:delegated-task:${"encoded-parent".repeat(90)}`);
  return withService(
    ({ service, fs }) =>
      Effect.gen(function* () {
        yield* service.answer({ ...save, threadId: delegated });
        const file = yield* service.saveToFile({ threadId: delegated, turnItemId });
        assert.match(file, /\/files\/[0-9a-f]{32}$/);
        assert.equal(yield* fs.readFileString(file), secret);
      }),
    { threadId: delegated },
  );
});

it.effect("success and failure traces contain no plaintext value", () =>
  Effect.gen(function* () {
    const spans: Array<Tracer.NativeSpan> = [];
    const tracer = Tracer.make({
      span: (options) => {
        const span = new Tracer.NativeSpan(options);
        spans.push(span);
        return span;
      },
    });
    yield* withService(({ service, state }) =>
      Effect.gen(function* () {
        state.recordFailures = 1;
        yield* service.answer(save).pipe(Effect.result);
        yield* service.answer(save);
        yield* service.saveToFile({ threadId, turnItemId });
      }),
    ).pipe(Effect.withTracer(tracer));
    const recorded = spans.flatMap((span) => [
      span.name,
      ...Array.from(span.attributes.values(), String),
    ]);
    assert.include(recorded, "SecretRequests.answer");
    assert.include(recorded, "SecretRequests.saveToFile");
    assert.isFalse(recorded.some((value) => value.includes(secret)));
  }),
);

it.effect("a request cannot be answered through another thread", () =>
  withService(({ service, fs, directory }) =>
    Effect.gen(function* () {
      const wrongThread = ThreadId.make("another-thread");
      assert.equal(
        (yield* service.answer({ ...save, threadId: wrongThread }).pipe(Effect.flip)).reason,
        "not_found",
      );
      assert.deepEqual(yield* requestFiles(fs, directory), []);
    }),
  ),
);

it.effect("queued runs and requests from a different root cannot accept secrets", () =>
  withService(({ service, fs, directory, state }) =>
    Effect.gen(function* () {
      state.runStatus = "queued";
      assert.equal((yield* service.answer(save).pipe(Effect.flip)).reason, "agent_stopped");
      state.runStatus = "running";
      state.rootNodeId = "another-root";
      assert.equal((yield* service.answer(save).pipe(Effect.flip)).reason, "agent_stopped");
      assert.deepEqual(yield* requestFiles(fs, directory), []);
    }),
  ),
);

it.effect("contract and client submission preserve exact secret bytes in the delivered file", () =>
  withService(({ service, fs }) =>
    Effect.gen(function* () {
      const entered = "  a b λ  ";
      const decoded = decodeAnswer({ ...save, answer: { type: "save", secret: entered } });
      const submission = secretRequestAnswerInput(
        { threadId: decoded.threadId, id: decoded.turnItemId },
        decoded.answer,
      );
      if (submission === null) return assert.fail("A nonblank secret must be accepted.");
      yield* service.answer(decodeAnswer(encodeAnswer(submission)));
      const file = yield* service.saveToFile({ threadId, turnItemId });
      assert.deepEqual(
        Array.from(yield* fs.readFile(file)),
        Array.from(new TextEncoder().encode(entered)),
      );
    }),
  ),
);
