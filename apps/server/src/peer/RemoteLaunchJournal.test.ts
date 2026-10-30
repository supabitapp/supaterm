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
