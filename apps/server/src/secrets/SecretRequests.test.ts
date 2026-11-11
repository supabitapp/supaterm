import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as HostProcess from "@supaterm/shared/HostProcess";
import {
  OrchestratorMcpRequestSecretInput,
  ProjectId,
  type OrchestrationV2ServerCommand,
  ThreadId,
  TurnItemId,
} from "@supaterm/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Tracer from "effect/Tracer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as SecretRequests from "./SecretRequests.ts";

const threadId = ThreadId.make("thread-orchestrator");
const turnItemId = TurnItemId.make("turn-item:secret-request:1");
const projectId = ProjectId.make("project-1");
const decodeSecretInput = Schema.decodeUnknownEffect(OrchestratorMcpRequestSecretInput);
const decodeSecretInputExit = Schema.decodeUnknownExit(OrchestratorMcpRequestSecretInput);

const withService = <A, E>(
  body: (input: {
    readonly service: SecretRequests.SecretRequests["Service"];
    readonly stored: Map<string, Uint8Array>;
    readonly dispatched: Array<OrchestrationV2ServerCommand>;
  }) => Effect.Effect<A, E>,
  options: {
    readonly threadId?: ThreadId;
    readonly directory?: string;
    readonly runStatus?: string;
    readonly removeFails?: boolean;
    readonly closedFirst?: boolean;
    readonly failedRecords?: number;
    readonly fields?: ReadonlyArray<{ readonly name: string; readonly label: string }>;
    /** Interrupts the answer at this stored value, as a dropped client connection does. */
    readonly interruptAtCreate?: number;
  } = {},
) =>
  Effect.gen(function* () {
    const stored = new Map<string, Uint8Array>();
    const dispatched: Array<OrchestrationV2ServerCommand> = [];
    let secretStatus = "pending";
    let failedRecords = options.failedRecords ?? 0;
    let writes = 0;
    const write = (name: string, value: Uint8Array) =>
      Effect.suspend(() => {
        writes += 1;
        if (writes === options.interruptAtCreate) return Effect.interrupt;
        return Effect.sync(() => void stored.set(name, value));
      });
    const requestThreadId = options.threadId ?? threadId;
    const layerDependencies = Layer.mergeAll(
      NodeCrypto.layer,
      NodeServices.layer,
      Layer.succeed(
        ServerSecretStore.ServerSecretStore,
        ServerSecretStore.ServerSecretStore.of({
          ...(options.directory === undefined ? {} : { directory: options.directory }),
          get: (name) => Effect.yieldNow.pipe(Effect.as(Option.fromNullishOr(stored.get(name)))),
          set: write,
          create: (name, value) =>
            stored.has(name)
              ? Effect.fail(
                  new ServerSecretStore.SecretStorePersistError({
                    resource: name,
                    cause: new PlatformError.PlatformError(
                      new PlatformError.SystemError({
                        _tag: "AlreadyExists",
                        module: "FileSystem",
                        method: "open",
                      }),
                    ),
                  } as never),
                )
              : write(name, value),
          getOrCreateRandom: (name, bytes) =>
            Effect.sync(() => {
              const existing = stored.get(name);
              if (existing) return existing;
              const value = new Uint8Array(bytes).fill(7);
              stored.set(name, value);
              return value;
            }),
          remove: (name) =>
            options.removeFails
              ? Effect.fail(
                  new ServerSecretStore.SecretStorePersistError({
                    resource: name,
                    cause: new Error("read-only"),
                  }),
                )
              : Effect.sync(() => void stored.delete(name)),
        }),
      ),
      Layer.mock(ThreadManagementService.ThreadManagementService)({
        getThreadRecords: () =>
          Effect.succeed({
            thread: { projectId },
            runs: [{ id: "run-1", status: options.runStatus ?? "running" }],
            turnItems: [
              {
                id: turnItemId,
                threadId: requestThreadId,
                runId: "run-1",
                nodeId: "node-root",
                type: "secret_request",
                label: "GitHub token",
                reason: "Used as GH_TOKEN.",
                url: "https://github.com/settings/tokens",
                ...(options.fields === undefined ? {} : { fields: options.fields }),
                secretStatus,
              },
            ],
          } as never),
        dispatch: (command) => {
          if (command.type === "secret_request.record" && failedRecords > 0) {
            failedRecords -= 1;
            return Effect.fail(new Error("orchestrator unavailable") as never);
          }
          return Effect.sync(() => {
            dispatched.push(command);
            if (options.closedFirst && command.type === "secret_request.record") {
              secretStatus = "cancelled";
            } else if (command.type === "secret_request.record" && secretStatus === "pending") {
              secretStatus = command.secretStatus;
            }
            return {} as never;
          });
        },
      }),
    );
    return yield* Effect.gen(function* () {
      const service = yield* SecretRequests.SecretRequests;
      return yield* body({ service, stored, dispatched });
    }).pipe(Effect.provide(SecretRequests.layer.pipe(Layer.provide(layerDependencies))));
  });

const saveFile = (service: SecretRequests.SecretRequests["Service"]) =>
  service
    .saveToFile({ threadId, turnItemId })
    .pipe(Effect.map((saved) => ("file" in saved ? saved.file : assert.fail("expected one file"))));

const valuesOf = (stored: Map<string, Uint8Array>) =>
  Array.from(stored.entries())
    .filter(([name]) => name !== "secret-request-salt")
    .map(([, bytes]) => new TextDecoder().decode(bytes));

it.effect("a saved answer is stored, and the thread only learns it was saved", () =>
  withService(({ service, stored, dispatched }) =>
    Effect.gen(function* () {
      yield* service.answer({
        threadId,
        turnItemId,
        answer: { type: "save", secret: "ghp_secret" },
      });
      assert.equal(dispatched.length, 1);
      assert.include(dispatched[0] as object, {
        type: "secret_request.record",
        secretStatus: "saved",
        url: "https://github.com/settings/tokens",
      });
      assert.notInclude(Object.values(dispatched[0] as object).map(String), "ghp_secret");
      assert.isTrue(valuesOf(stored).some((value) => value.includes("ghp_secret")));
    }),
  ),
);

it.effect("two concurrent deliveries write one file and return the same path", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "secret-files-test-" });
    yield* withService(
      ({ service, stored }) =>
        Effect.gen(function* () {
          yield* service.answer({
            threadId,
            turnItemId,
            answer: { type: "save", secret: "ghp_secret" },
          });
          const [first, second] = yield* Effect.all([saveFile(service), saveFile(service)], {
            concurrency: "unbounded",
          });
          assert.equal(first, second);
          assert.equal(yield* fs.readFileString(first), "ghp_secret");
          assert.deepEqual(valuesOf(stored), []);
        }),
      { directory },
    );
  }).pipe(Effect.provide(NodeServices.layer)),
);

const loginFields = [
  { name: "email", label: "Email" },
  { name: "constructor", label: "Password" },
  { name: "__proto__", label: "Code" },
];
// Built from entries: a literal `__proto__` key would set the prototype instead.
const loginValues = (email: string, password: string, code = "482916") =>
  Object.fromEntries([
    ["email", email],
    ["constructor", password],
    ["__proto__", code],
  ]);

it.effect("a card with fields stores and delivers one file per field", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "secret-files-test-" });
    yield* withService(
      ({ service, stored, dispatched }) =>
        Effect.gen(function* () {
          for (const answer of [
            { type: "save", secret: "hunter2" },
            { type: "save", values: { email: "qa@example.com" } },
            {
              type: "save",
              values: { email: "qa@example.com", password: "hunter2", code: "482916" },
            },
          ] as const) {
            const mismatch = yield* service
              .answer({ threadId, turnItemId, answer })
              .pipe(Effect.flip);
            assert.equal(mismatch.reason, "fields_mismatch");
          }
          assert.deepEqual(valuesOf(stored), []);
          assert.deepEqual(dispatched, []);

          yield* service.answer({
            threadId,
            turnItemId,
            answer: { type: "save", values: loginValues("qa@example.com", "hunter2") },
          });
          assert.equal(valuesOf(stored).length, 3);
          assert.include(dispatched[0] as object, { secretStatus: "saved" });
          assert.deepEqual((dispatched[0] as { fields?: unknown }).fields, loginFields);
          assert.isFalse(JSON.stringify(dispatched).includes("hunter2"));

          const saved = yield* service.saveToFile({ threadId, turnItemId });
          assert.isTrue("files" in saved);
          if (!("files" in saved)) return;
          const files = new Map(Object.entries(saved.files));
          assert.deepEqual([...files.keys()], ["email", "constructor", "__proto__"]);
          assert.equal(yield* fs.readFileString(files.get("__proto__")!), "482916");
          assert.notEqual(files.get("email"), files.get("constructor"));
          assert.equal(yield* fs.readFileString(files.get("email")!), "qa@example.com");
          assert.equal(yield* fs.readFileString(files.get("constructor")!), "hunter2");
          assert.deepEqual(valuesOf(stored), []);
        }),
      { directory, fields: loginFields },
    );
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("an answer cut off midway never mixes with the next one", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "secret-files-test-" });
    yield* withService(
      ({ service }) =>
        Effect.gen(function* () {
          const cut = yield* service
            .answer({
              threadId,
              turnItemId,
              answer: { type: "save", values: loginValues("first@example.com", "first-pass") },
            })
            .pipe(Effect.exit);
          assert.isTrue(Exit.hasInterrupts(cut));
          yield* service.answer({
            threadId,
            turnItemId,
            answer: { type: "save", values: loginValues("second@example.com", "second-pass") },
          });
          const saved = yield* service.saveToFile({ threadId, turnItemId });
          if (!("files" in saved)) return assert.fail("expected one file per field");
          const files = new Map(Object.entries(saved.files));
          assert.equal(yield* fs.readFileString(files.get("email")!), "second@example.com");
          assert.equal(yield* fs.readFileString(files.get("constructor")!), "second-pass");
        }),
      // The salt is the first write, so the third is the second field.
      { directory, fields: loginFields, interruptAtCreate: 3 },
    );
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("a card with fields that closed first deletes every value", () =>
  withService(
    ({ service, stored }) =>
      Effect.gen(function* () {
        const error = yield* service
          .answer({
            threadId,
            turnItemId,
            answer: { type: "save", values: loginValues("qa@example.com", "hunter2") },
          })
          .pipe(Effect.flip);
        assert.equal(error.reason, "agent_stopped");
        assert.deepEqual(valuesOf(stored), []);
      }),
    { closedFirst: true, fields: loginFields },
  ),
);

it.effect("a save that loses to the card closing deletes the value and says so", () =>
  withService(
    ({ service, stored }) =>
      Effect.gen(function* () {
        const error = yield* service
          .answer({ threadId, turnItemId, answer: { type: "save", secret: "ghp_secret" } })
          .pipe(Effect.flip);
        assert.equal(error.reason, "agent_stopped");
        assert.isFalse(valuesOf(stored).some((value) => value.includes("ghp_secret")));
      }),
    { closedFirst: true },
  ),
);

it.effect("a save whose record failed can be saved again", () =>
  withService(
    ({ service, stored }) =>
      Effect.gen(function* () {
        const failed = yield* service
          .answer({ threadId, turnItemId, answer: { type: "save", secret: "ghp_secret" } })
          .pipe(Effect.flip);
        assert.equal(failed.reason, "record_failed");
        assert.deepEqual(valuesOf(stored), []);
        yield* service.answer({
          threadId,
          turnItemId,
          answer: { type: "save", secret: "ghp_secret" },
        });
        assert.isTrue(valuesOf(stored).some((value) => value.includes("ghp_secret")));
      }),
    { failedRecords: 1 },
  ),
);

it.effect("declining stores nothing, and a request is answered once", () =>
  withService(({ service, stored, dispatched }) =>
    Effect.gen(function* () {
      yield* service.answer({ threadId, turnItemId, answer: { type: "decline" } });
      assert.deepEqual(valuesOf(stored), []);
      const late = yield* service
        .answer({ threadId, turnItemId, answer: { type: "save", secret: "ghp_secret" } })
        .pipe(Effect.flip);
      assert.include(late.message, "already answered");
      assert.equal(dispatched.length, 1);
      assert.deepEqual(valuesOf(stored), []);
    }),
  ),
);

it.effect("traces an answer and its delivery without ever recording the value", () =>
  Effect.gen(function* () {
    const spans: Array<Tracer.NativeSpan> = [];
    const tracer = Tracer.make({
      span: (options) => {
        const span = new Tracer.NativeSpan(options);
        spans.push(span);
        return span;
      },
    });
    const fs = yield* FileSystem.FileSystem;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "secret-files-test-" });
    yield* withService(
      ({ service }) =>
        Effect.gen(function* () {
          yield* service.answer({
            threadId,
            turnItemId,
            answer: { type: "save", secret: "ghp_secret" },
          });
          yield* saveFile(service);
        }),
      { directory },
    ).pipe(Effect.withTracer(tracer));
    const recorded = spans.flatMap((span) => [
      span.name,
      ...Array.from(span.attributes.values(), String),
    ]);
    assert.include(recorded, "SecretRequests.answer");
    assert.include(recorded, "SecretRequests.saveToFile");
    assert.isFalse(recorded.some((value) => value.includes("ghp_secret")));
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("works in threads with long ids, such as a delegated subagent's", () => {
  const delegatedThreadId = ThreadId.make(
    `thread:delegated-task:command%3Amcp%3A${"a".repeat(36)}%3Adelegate-task%3Arelease-notes-v0.2.0-${"b".repeat(40)}`,
  );
  return withService(
    ({ service, stored }) =>
      Effect.gen(function* () {
        yield* service.answer({
          threadId: delegatedThreadId,
          turnItemId,
          answer: { type: "save", secret: "ghp_secret" },
        });
        assert.isTrue(Array.from(stored.keys()).every((name) => name.length < 100));
      }),
    { threadId: delegatedThreadId },
  );
});

it.effect("refuses an answer once the agent that asked has stopped", () =>
  withService(
    ({ service, stored, dispatched }) =>
      Effect.gen(function* () {
        const late = yield* service
          .answer({ threadId, turnItemId, answer: { type: "save", secret: "ghp_secret" } })
          .pipe(Effect.flip);
        assert.include(late.message, "has stopped");
        assert.deepEqual(valuesOf(stored), []);
        assert.equal(dispatched.length, 0);
      }),
    { runStatus: "completed" },
  ),
);

const SECRET_FILE_TTL_MS = 24 * 60 * 60 * 1000;

it.effect("a file request moves its value to an owner-only file, once", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "secret-files-test-" });
    const file = yield* withService(
      ({ service, stored, dispatched }) =>
        Effect.gen(function* () {
          yield* service.answer({
            threadId,
            turnItemId,
            answer: { type: "save", secret: "cf_token'$(id)" },
          });
          assert.include(dispatched[0] as object, { secretStatus: "saved" });
          const file = yield* saveFile(service);
          assert.equal(yield* fs.readFileString(file), "cf_token'$(id)");
          assert.deepEqual(valuesOf(stored), []);
          if ((yield* HostProcess.Platform) !== "win32") {
            assert.equal((yield* fs.stat(file)).mode & 0o777, 0o600);
            assert.equal((yield* fs.stat(path.dirname(file))).mode & 0o777, 0o700);
          }
          // A retried request_secret gets the same file.
          assert.equal(yield* saveFile(service), file);
          return file;
        }),
      { directory },
    );

    const { mtime } = yield* fs.stat(file);
    yield* TestClock.setTime(Option.getOrThrow(mtime).getTime() + SECRET_FILE_TTL_MS);
    yield* withService(() => Effect.void, { directory });
    assert.isTrue(yield* fs.exists(file));
    yield* TestClock.setTime(Option.getOrThrow(mtime).getTime() + SECRET_FILE_TTL_MS + 1);
    yield* withService(() => Effect.void, { directory });
    assert.isFalse(yield* fs.exists(file));
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("a failed file write keeps the value, so the request can retry", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "secret-files-test-" });
    yield* withService(
      ({ service }) =>
        Effect.gen(function* () {
          yield* service.answer({
            threadId,
            turnItemId,
            answer: { type: "save", secret: "cf_token" },
          });
          // A plain file where the files directory goes makes the write fail.
          const blocker = path.join(directory, "files");
          yield* fs.writeFileString(blocker, "");
          const failed = yield* saveFile(service).pipe(Effect.flip);
          assert.equal(failed.reason, "store_failed");
          yield* fs.remove(blocker);
          const file = yield* saveFile(service);
          assert.equal(yield* fs.readFileString(file), "cf_token");
        }),
      { directory },
    );
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("a file is not delivered while its stored copy cannot be removed", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "secret-files-test-" });
    yield* withService(
      ({ service }) =>
        Effect.gen(function* () {
          yield* service.answer({
            threadId,
            turnItemId,
            answer: { type: "save", secret: "cf_token" },
          });
          const first = yield* saveFile(service).pipe(Effect.flip);
          assert.equal(first.reason, "delivery_failed");
          // A retry finds the file but still will not hand it out until the removal works.
          const retried = yield* saveFile(service).pipe(Effect.flip);
          assert.equal(retried.reason, "delivery_failed");
        }),
      { directory, removeFails: true },
    );
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("a pasted secret goes straight to an owner-only file, with no card", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "secret-files-test-" });
    const spans: Array<Tracer.NativeSpan> = [];
    const tracer = Tracer.make({
      span: (options) => {
        const span = new Tracer.NativeSpan(options);
        spans.push(span);
        return span;
      },
    });
    const pasted = "4829'$(id) 16";
    const file = yield* withService(
      ({ service, stored, dispatched }) =>
        Effect.gen(function* () {
          const file = yield* service.savePasted({
            threadId,
            requestNamespace: "session-a",
            requestKey: "key-1",
            value: pasted,
          });
          assert.equal(path.dirname(file), path.join(directory, "files"));
          assert.match(path.basename(file), /^[0-9a-f]{32}$/);
          assert.equal(yield* fs.readFileString(file), pasted);
          if ((yield* HostProcess.Platform) !== "win32") {
            assert.equal((yield* fs.stat(file)).mode & 0o777, 0o600);
            assert.equal((yield* fs.stat(path.dirname(file))).mode & 0o777, 0o700);
          }
          // No card and no stored copy: the thread never hears of it.
          assert.deepEqual(dispatched, []);
          assert.deepEqual(valuesOf(stored), []);
          // A retry with the same key gets the same file, unchanged even if the value differs.
          assert.equal(
            yield* service.savePasted({
              threadId,
              requestNamespace: "session-a",
              requestKey: "key-1",
              value: "other",
            }),
            file,
          );
          assert.equal(yield* fs.readFileString(file), pasted);
          // Another key, or the same key from another provider session, gets its own file.
          const other = yield* service.savePasted({
            threadId,
            requestNamespace: "session-a",
            requestKey: "key-2",
            value: "x",
          });
          assert.notEqual(other, file);
          const otherSession = yield* service.savePasted({
            threadId,
            requestNamespace: "session-b",
            requestKey: "key-1",
            value: "y",
          });
          assert.notEqual(otherSession, file);
          assert.equal(yield* fs.readFileString(file), pasted);
          return file;
        }).pipe(Effect.withTracer(tracer)),
      { directory },
    );
    const recorded = spans.flatMap((span) => [
      span.name,
      ...Array.from(span.attributes.values(), String),
    ]);
    assert.include(recorded, "SecretRequests.savePasted");
    assert.isFalse(recorded.some((value) => value.includes("4829")));

    const { mtime } = yield* fs.stat(file);
    yield* TestClock.setTime(Option.getOrThrow(mtime).getTime() + SECRET_FILE_TTL_MS);
    yield* withService(() => Effect.void, { directory });
    assert.isTrue(yield* fs.exists(file));
    yield* TestClock.setTime(Option.getOrThrow(mtime).getTime() + SECRET_FILE_TTL_MS + 1);
    yield* withService(() => Effect.void, { directory });
    assert.isFalse(yield* fs.exists(file));
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("a pasted secret keeps its exact bytes from the tool input to the file", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "secret-files-test-" });
    const pasted = "  pa ss\tword\t ";
    const input = yield* decodeSecretInput({
      label: "Staging password",
      reason: "Signs in the QA account.",
      value: pasted,
    });
    assert.equal(input.value, pasted);
    const empty = decodeSecretInputExit({
      label: "Staging password",
      reason: "Signs in the QA account.",
      value: "",
    });
    assert.isTrue(Exit.isFailure(empty));
    for (const url of ["https://?state=x", "javascript:alert(1)"]) {
      assert.isTrue(
        Exit.isFailure(decodeSecretInputExit({ label: "Code", reason: "Sign in.", url })),
        url,
      );
    }
    const file = yield* withService(
      ({ service }) =>
        service.savePasted({
          threadId,
          requestNamespace: "session-a",
          requestKey: "key-1",
          value: input.value!,
        }),
      { directory },
    );
    assert.equal(yield* fs.readFileString(file), pasted);
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("a pasted secret is refused without a secrets directory", () =>
  withService(({ service }) =>
    Effect.gen(function* () {
      const failed = yield* service
        .savePasted({ threadId, requestNamespace: "session-a", requestKey: "key-1", value: "4829" })
        .pipe(Effect.flip);
      assert.equal(failed.reason, "store_failed");
    }),
  ),
);
