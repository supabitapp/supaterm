import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  EnvironmentId,
  NodeId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
} from "@supaterm/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PlatformError from "effect/PlatformError";

import * as ServerConfig from "../config.ts";
import * as RemoteLaunchJournal from "./RemoteLaunchJournal.ts";

const intent: RemoteLaunchJournal.RemoteLaunchIntent = {
  id: "a".repeat(64),
  label: "Remote",
  parentThreadId: ThreadId.make("parent"),
  parentRunId: RunId.make("parent-run"),
  parentNodeId: NodeId.make("parent-node"),
  providerInstanceId: ProviderInstanceId.make("codex"),
  requestNamespace: "original-credential",
  targetEnvironmentId: EnvironmentId.make("remote"),
  credentialId: "peer-link-original",
  runtimeMode: "full-access",
  interactionMode: "default",
  launch: {
    projectId: ProjectId.make("remote-project"),
    title: "Delegated work",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "model" },
    message: "Complete the work",
    clientRequestId: "stable-remote-key",
    delegatedFrom: {
      environmentId: EnvironmentId.make("local"),
      threadId: ThreadId.make("parent"),
      title: "Parent",
    },
  },
  task: "Complete the work",
  completionWake: "always",
  remote: null,
  taskId: null,
};

const remote = {
  threadId: ThreadId.make("child"),
  projectId: intent.launch.projectId,
  modelSelection: intent.launch.modelSelection,
  runId: RunId.make("child-run"),
  status: "running" as const,
};

it.effect("recovers the original launch and its acknowledgement across restarts", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const directory = yield* fs.makeTempDirectoryScoped();
    const layer = RemoteLaunchJournal.layer.pipe(
      Layer.provide(ServerConfig.layerTest(process.cwd(), directory)),
    );
    const inJournal = <A, E>(
      use: (journal: RemoteLaunchJournal.RemoteLaunchJournal["Service"]) => Effect.Effect<A, E>,
    ) => RemoteLaunchJournal.RemoteLaunchJournal.pipe(Effect.flatMap(use), Effect.provide(layer));

    assert.deepEqual(yield* inJournal((journal) => journal.prepare(intent)), intent);
    const afterRestart = yield* inJournal((journal) => journal.pending);
    assert.deepEqual(afterRestart, [intent]);
    const repeated = yield* inJournal((journal) =>
      journal.prepare({ ...intent, task: "A retry must keep the first request" }),
    );
    assert.deepEqual(repeated, intent);
    yield* inJournal((journal) => journal.recordLaunch(intent, remote));
    assert.deepEqual(yield* inJournal((journal) => journal.pending), [{ ...intent, remote }]);
    yield* inJournal((journal) => journal.complete({ ...intent, remote }, NodeId.make("task")));
    assert.deepEqual(yield* inJournal((journal) => journal.pending), []);
    assert.deepEqual(yield* inJournal((journal) => journal.prepare(intent)), {
      ...intent,
      remote,
      taskId: NodeId.make("task"),
    });
    const lookup = {
      parentThreadId: intent.parentThreadId,
      taskId: NodeId.make("task"),
      environmentId: intent.targetEnvironmentId,
      threadId: remote.threadId,
    };
    const authority = yield* inJournal((journal) => journal.getTaskLaunch(lookup));
    assert.isTrue(Option.isSome(authority));
    if (Option.isSome(authority)) {
      assert.equal(authority.value.credentialId, intent.credentialId);
      assert.equal(authority.value.runtimeMode, intent.runtimeMode);
    }
    assert.isTrue(
      Option.isNone(
        yield* inJournal((journal) =>
          journal.getTaskLaunch({ ...lookup, threadId: ThreadId.make("another-child") }),
        ),
      ),
    );
    assert.isTrue(
      Option.isNone(
        yield* inJournal((journal) =>
          journal.getTaskLaunch({ ...lookup, parentThreadId: ThreadId.make("another-parent") }),
        ),
      ),
    );
    assert.isTrue(
      Option.isNone(
        yield* inJournal((journal) =>
          journal.getTaskLaunch({ ...lookup, taskId: NodeId.make("another-task") }),
        ),
      ),
    );
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
);

it.effect("keeps a recoverable intent when saving the remote acknowledgement fails", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const directory = yield* fs.makeTempDirectoryScoped();
    let failRename = false;
    const filesystem = Layer.succeed(FileSystem.FileSystem, {
      ...fs,
      rename: (from, to) =>
        failRename
          ? Effect.fail(
              PlatformError.systemError({
                _tag: "PermissionDenied",
                module: "FileSystem",
                method: "rename",
              }),
            )
          : fs.rename(from, to),
    });
    const layer = RemoteLaunchJournal.layer.pipe(
      Layer.provide(ServerConfig.layerTest(process.cwd(), directory)),
      Layer.provide(filesystem),
    );
    yield* Effect.gen(function* () {
      const journal = yield* RemoteLaunchJournal.RemoteLaunchJournal;
      yield* journal.prepare(intent);
      failRename = true;
      const failed = yield* journal.recordLaunch(intent, remote).pipe(Effect.flip);
      assert.equal(failed._tag, "RemoteLaunchJournalError");
      assert.deepEqual(yield* journal.pending, [intent]);
    }).pipe(Effect.provide(layer));
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
);

it.effect(
  "retains cleanup authority through task registration and removes it with the intent",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* fs.makeTempDirectoryScoped();
      yield* Effect.gen(function* () {
        const journal = yield* RemoteLaunchJournal.RemoteLaunchJournal;
        const lookup = {
          parentThreadId: intent.parentThreadId,
          taskId: NodeId.make("task"),
          environmentId: intent.targetEnvironmentId,
          threadId: remote.threadId,
        };
        assert.isTrue(Option.isNone(yield* journal.getTaskLaunch(lookup)));
        yield* journal.prepare(intent);
        const launched = yield* journal.recordLaunch(intent, remote);
        assert.deepEqual(yield* journal.getTaskLaunch(lookup), Option.some(launched));
        yield* journal.complete(launched, lookup.taskId);
        assert.deepEqual(
          yield* journal.getTaskLaunch(lookup),
          Option.some({ ...launched, taskId: lookup.taskId }),
        );
        assert.isTrue(
          Option.isNone(
            yield* journal.getTaskLaunch({ ...lookup, taskId: NodeId.make("another-task") }),
          ),
        );
        yield* journal.remove(intent.id);
        assert.isTrue(Option.isNone(yield* journal.getTaskLaunch(lookup)));
      }).pipe(
        Effect.provide(
          RemoteLaunchJournal.layer.pipe(
            Layer.provide(ServerConfig.layerTest(process.cwd(), directory)),
          ),
        ),
      );
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
);
