import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import {
  CheckpointScopeId,
  NodeId,
  ProviderThreadId,
  RunId,
  ThreadId,
  type OrchestrationV2CheckpointScope,
  VcsProcessExitError,
  VcsProcessTimeoutError,
  VcsUnsupportedOperationError,
} from "@supaterm/contracts";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as TestClock from "effect/testing/TestClock";

import * as CheckpointStore from "../checkpointing/CheckpointStore.ts";
import * as CheckpointService from "./CheckpointService.ts";
import * as IdAllocator from "@supaterm/provider-core/server/IdAllocator";

it.effect(
  "skips unsupported baseline and turn checkpoints without swallowing capture failures",
  () =>
    Effect.gen(function* () {
      const scope: OrchestrationV2CheckpointScope = {
        id: CheckpointScopeId.make("checkpoint-scope:capture-failure"),
        threadId: ThreadId.make("thread:capture-failure"),
        runId: RunId.make("run:capture-failure:1"),
        nodeId: NodeId.make("node:capture-failure:1"),
        parentScopeId: null,
        providerThreadId: ProviderThreadId.make("provider-thread:capture-failure"),
        kind: "root_run",
        ordinalWithinParent: 0,
        advancesAppRunCount: true,
        cwd: "/repo/ignored",
        createdAt: DateTime.makeUnsafe("2026-07-28T00:00:00.000Z"),
      };
      for (const captureError of [
        new VcsProcessTimeoutError({
          operation: "test.capture",
          command: "git",
          cwd: scope.cwd,
          timeoutMs: 30000,
        }),
        new VcsUnsupportedOperationError({
          operation: "test.capture",
          kind: "git",
          detail: "The workspace directory is ignored by its Git repository.",
        }),
      ]) {
        const layerTest = CheckpointService.layer.pipe(
          Layer.provide(
            Layer.mergeAll(
              IdAllocator.layer,
              Layer.mock(CheckpointStore.CheckpointStore)({
                isGitRepository: () => Effect.succeed(true),
                hasCheckpointRef: () => Effect.succeed(false),
                captureCheckpoint: () => Effect.fail(captureError),
              }),
            ),
          ),
          Layer.provideMerge(NodeCrypto.layer),
        );
        yield* Effect.gen(function* () {
          const checkpoints = yield* CheckpointService.CheckpointServiceV2;
          const baseline = yield* Effect.result(
            checkpoints.captureBaseline({ scope, ordinalWithinScope: 0 }),
          );
          const checkpoint = yield* checkpoints.capture({
            scope,
            ordinalWithinScope: 1,
            runId: scope.runId!,
            nodeId: scope.nodeId!,
            appRunOrdinal: 1,
            capturedAt: scope.createdAt,
          });

          assert.deepEqual(
            { baseline: baseline._tag, turn: checkpoint.status, files: checkpoint.files },
            captureError._tag === "VcsUnsupportedOperationError"
              ? { baseline: "Success", turn: "missing", files: [] }
              : { baseline: "Failure", turn: "error", files: [] },
          );
          if (baseline._tag === "Failure") {
            assert.strictEqual(baseline.failure.cause, captureError);
          } else {
            const materialized = yield* checkpoints.materializeBaselineCheckpoint({
              scope,
              ordinalWithinScope: 0,
              nodeId: scope.nodeId,
              capturedAt: scope.createdAt,
            });
            assert.strictEqual(materialized.status, "missing");
          }
        }).pipe(Effect.provide(layerTest));
      }
    }),
);

it.effect(
  "bounds a slow baseline snapshot but waits for an in-flight capture of the same ref",
  () =>
    Effect.gen(function* () {
      const scope: OrchestrationV2CheckpointScope = {
        id: CheckpointScopeId.make("checkpoint-scope:slow-baseline"),
        threadId: ThreadId.make("thread:slow-baseline"),
        runId: RunId.make("run:slow-baseline:1"),
        nodeId: NodeId.make("node:slow-baseline:1"),
        parentScopeId: null,
        providerThreadId: ProviderThreadId.make("provider-thread:slow-baseline"),
        kind: "root_run",
        ordinalWithinParent: 0,
        advancesAppRunCount: true,
        cwd: "/repo/slow",
        createdAt: DateTime.makeUnsafe("2026-07-28T00:00:00.000Z"),
      };
      const refs = yield* Ref.make<ReadonlySet<string>>(new Set());
      const snapshots = yield* Ref.make(0);
      const firstSnapshotStarted = yield* Deferred.make<void>();
      const layerTest = CheckpointService.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            IdAllocator.layer,
            Layer.mock(CheckpointStore.CheckpointStore)({
              isGitRepository: () => Effect.succeed(true),
              hasCheckpointRef: ({ checkpointRef }) =>
                Ref.get(refs).pipe(Effect.map((current) => current.has(checkpointRef))),
              captureCheckpoint: ({ checkpointRef }) =>
                Effect.gen(function* () {
                  yield* Ref.update(snapshots, (count) => count + 1);
                  yield* Deferred.succeed(firstSnapshotStarted, undefined);
                  yield* Effect.sleep("10 seconds");
                  yield* Ref.update(refs, (current) => new Set([...current, checkpointRef]));
                }),
            }),
          ),
        ),
        Layer.provideMerge(NodeCrypto.layer),
      );

      yield* Effect.gen(function* () {
        const checkpoints = yield* CheckpointService.CheckpointServiceV2;
        // A stopped run's post-turn capture writes the next run's baseline ref while holding the lock.
        const postTurn = yield* checkpoints
          .capture({
            scope,
            ordinalWithinScope: 1,
            runId: scope.runId!,
            nodeId: scope.nodeId!,
            appRunOrdinal: 1,
            capturedAt: scope.createdAt,
          })
          .pipe(Effect.forkChild);
        yield* Deferred.await(firstSnapshotStarted);
        const waitingBaseline = yield* checkpoints
          .captureBaseline({ scope, ordinalWithinScope: 1 })
          .pipe(Effect.result, Effect.forkChild);
        yield* TestClock.adjust("10 seconds");
        assert.strictEqual((yield* Fiber.join(postTurn)).status, "ready");
        assert.strictEqual((yield* Fiber.join(waitingBaseline))._tag, "Success");

        for (const ordinalWithinScope of [2, 3]) {
          const slowBaseline = yield* checkpoints
            .captureBaseline({ scope, ordinalWithinScope })
            .pipe(Effect.result, Effect.forkChild);
          yield* TestClock.adjust("5 seconds");
          const result = yield* Fiber.join(slowBaseline);
          assert.strictEqual(result._tag, "Failure");
          if (result._tag === "Failure") {
            assert.isTrue(Cause.isTimeoutError(result.failure.cause));
          }
        }
        const backedOffBaseline = yield* checkpoints
          .captureBaseline({ scope, ordinalWithinScope: 4 })
          .pipe(Effect.result, Effect.forkChild);
        yield* TestClock.adjust("5 seconds");
        assert.strictEqual((yield* Fiber.join(backedOffBaseline))._tag, "Success");
        assert.strictEqual(yield* Ref.get(snapshots), 3);
        assert.strictEqual((yield* Ref.get(refs)).size, 1);
      }).pipe(Effect.provide(layerTest));
    }),
);

it.effect("records a repository probe failure as an error checkpoint, not a missing one", () =>
  Effect.gen(function* () {
    const scope: OrchestrationV2CheckpointScope = {
      id: CheckpointScopeId.make("checkpoint-scope:probe-failure"),
      threadId: ThreadId.make("thread:probe-failure"),
      runId: RunId.make("run:probe-failure:1"),
      nodeId: NodeId.make("node:probe-failure:1"),
      parentScopeId: null,
      providerThreadId: ProviderThreadId.make("provider-thread:probe-failure"),
      kind: "root_run",
      ordinalWithinParent: 0,
      advancesAppRunCount: true,
      cwd: "/repo/bad-config",
      createdAt: DateTime.makeUnsafe("2026-07-28T00:00:00.000Z"),
    };
    const layerTest = CheckpointService.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          IdAllocator.layer,
          Layer.mock(CheckpointStore.CheckpointStore)({
            isGitRepository: () =>
              Effect.fail(
                new VcsProcessExitError({
                  operation: "GitVcsDriver.detectRepository",
                  command: "git",
                  cwd: scope.cwd,
                  exitCode: 128,
                  detail: "fatal: bad config line 1 in file .git/config",
                }),
              ),
          }),
        ),
      ),
      Layer.provideMerge(NodeCrypto.layer),
    );

    const statuses = yield* Effect.gen(function* () {
      const checkpoints = yield* CheckpointService.CheckpointServiceV2;
      const baseline = yield* checkpoints.materializeBaselineCheckpoint({
        scope,
        ordinalWithinScope: 0,
        nodeId: scope.nodeId,
        capturedAt: scope.createdAt,
      });
      const turn = yield* checkpoints.capture({
        scope,
        ordinalWithinScope: 1,
        runId: scope.runId!,
        nodeId: scope.nodeId!,
        appRunOrdinal: 1,
        capturedAt: scope.createdAt,
      });
      return { baseline: baseline.status, turn: turn.status };
    }).pipe(Effect.provide(layerTest));

    assert.deepEqual(statuses, { baseline: "error", turn: "error" });
  }),
);

it.effect("backs off only baseline retries after repeated workspace capture timeouts", () =>
  Effect.gen(function* () {
    const scope: OrchestrationV2CheckpointScope = {
      id: CheckpointScopeId.make("checkpoint-scope:slow-capture"),
      threadId: ThreadId.make("thread:slow-capture"),
      runId: RunId.make("run:slow-capture:1"),
      nodeId: NodeId.make("node:slow-capture:1"),
      parentScopeId: null,
      providerThreadId: ProviderThreadId.make("provider-thread:slow-capture"),
      kind: "root_run",
      ordinalWithinParent: 0,
      advancesAppRunCount: true,
      cwd: "/repo/slow",
      createdAt: DateTime.makeUnsafe("2026-07-28T00:00:00.000Z"),
    };
    const timeout = new VcsProcessTimeoutError({
      operation: "GitVcsDriver.checkpoints.captureCheckpoint",
      command: "git",
      cwd: scope.cwd,
      timeoutMs: 30_000,
    });
    let attempts = 0;
    let healthy = false;
    let nonTimeoutFailure = false;
    const failure = new VcsProcessExitError({
      operation: "test.capture",
      command: "git",
      cwd: scope.cwd,
      exitCode: 128,
      detail: "capture failed",
    });
    const layerTest = CheckpointService.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          IdAllocator.layer,
          Layer.mock(CheckpointStore.CheckpointStore)({
            isGitRepository: () => Effect.succeed(true),
            hasCheckpointRef: () => Effect.succeed(false),
            captureCheckpoint: () =>
              Effect.suspend(() => {
                attempts++;
                return healthy ? Effect.void : Effect.fail(nonTimeoutFailure ? failure : timeout);
              }),
          }),
        ),
      ),
      Layer.provideMerge(NodeCrypto.layer),
    );
    yield* Effect.gen(function* () {
      const checkpoints = yield* CheckpointService.CheckpointServiceV2;
      const baseline = { scope, ordinalWithinScope: 0 };
      const turn = {
        scope,
        ordinalWithinScope: 1,
        runId: scope.runId,
        nodeId: scope.nodeId,
        appRunOrdinal: 1,
        capturedAt: scope.createdAt,
      };
      yield* Effect.result(checkpoints.captureBaseline(baseline));
      assert.strictEqual((yield* checkpoints.capture(turn)).status, "error");
      assert.strictEqual(attempts, 2);

      const otherThread = { ...scope, id: CheckpointScopeId.make("checkpoint-scope:other") };
      const skipped = yield* Effect.result(
        checkpoints.captureBaseline({ scope: otherThread, ordinalWithinScope: 0 }),
      );
      assert.strictEqual(attempts, 2, "baseline retried a repeatedly timing-out workspace");
      assert.strictEqual(skipped._tag, "Success");

      yield* Effect.result(
        checkpoints.captureBaseline({
          scope: { ...otherThread, cwd: "/repo/other" },
          ordinalWithinScope: 0,
        }),
      );
      assert.strictEqual(attempts, 3, "another workspace must still attempt capture");

      const failedTurn = yield* checkpoints.capture(turn);
      assert.strictEqual(failedTurn.status, "error");
      assert.strictEqual(attempts, 4, "post-turn capture must not back off");

      yield* checkpoints.captureBaseline(baseline);
      assert.strictEqual(attempts, 4, "baseline retries must wait for post-turn recovery");
      healthy = true;
      assert.strictEqual((yield* checkpoints.capture(turn)).status, "ready");
      assert.strictEqual(attempts, 5);
      yield* checkpoints.captureBaseline(baseline);
      assert.strictEqual(attempts, 6, "a successful post-turn capture must clear backoff");

      healthy = false;
      yield* Effect.result(checkpoints.captureBaseline(baseline));
      yield* Effect.result(checkpoints.captureBaseline(baseline));
      yield* checkpoints.captureBaseline(baseline);
      assert.strictEqual(attempts, 8);
      nonTimeoutFailure = true;
      assert.strictEqual((yield* checkpoints.capture(turn)).status, "error");
      nonTimeoutFailure = false;
      yield* Effect.result(checkpoints.captureBaseline(baseline));
      assert.strictEqual(attempts, 10, "a non-timeout failure must clear backoff");
      healthy = true;
      yield* checkpoints.captureBaseline(baseline);
      healthy = false;
      yield* Effect.result(checkpoints.captureBaseline(baseline));
      yield* Effect.result(checkpoints.captureBaseline(baseline));
      assert.strictEqual(attempts, 13, "a successful baseline must clear the timeout streak");
    }).pipe(Effect.provide(layerTest));
  }),
);

it.effect("skips post-turn captures that waited out another capture's timeout in the folder", () =>
  Effect.gen(function* () {
    const scopeFor = (name: string): OrchestrationV2CheckpointScope => ({
      id: CheckpointScopeId.make(`checkpoint-scope:shared-folder:${name}`),
      threadId: ThreadId.make(`thread:shared-folder:${name}`),
      runId: RunId.make(`run:shared-folder:${name}:1`),
      nodeId: NodeId.make(`node:shared-folder:${name}:1`),
      parentScopeId: null,
      providerThreadId: ProviderThreadId.make(`provider-thread:shared-folder:${name}`),
      kind: "root_run",
      ordinalWithinParent: 0,
      advancesAppRunCount: true,
      cwd: "/repo/shared",
      createdAt: DateTime.makeUnsafe("2026-07-28T00:00:00.000Z"),
    });
    const attempts = yield* Ref.make(0);
    // Outcomes for upcoming attempts; an attempt with none scripted times out.
    const script = yield* Ref.make<ReadonlyArray<"ready" | "timeout">>([]);
    const started = yield* Queue.unbounded<void>();
    const layerTest = CheckpointService.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          IdAllocator.layer,
          Layer.mock(CheckpointStore.CheckpointStore)({
            isGitRepository: () => Effect.succeed(true),
            hasCheckpointRef: () => Effect.succeed(false),
            captureCheckpoint: ({ cwd }) =>
              Effect.gen(function* () {
                yield* Ref.update(attempts, (count) => count + 1);
                yield* Queue.offer(started, undefined);
                yield* Effect.sleep("30 seconds");
                const [next = "timeout", ...rest] = yield* Ref.get(script);
                yield* Ref.set(script, rest);
                if (next === "ready") return;
                return yield* new VcsProcessTimeoutError({
                  operation: "GitVcsDriver.checkpoints.captureCheckpoint",
                  command: "git",
                  cwd,
                  timeoutMs: 30_000,
                });
              }),
          }),
        ),
      ),
      Layer.provideMerge(NodeCrypto.layer),
    );
    yield* Effect.gen(function* () {
      const checkpoints = yield* CheckpointService.CheckpointServiceV2;
      const captureTurn = (scope: OrchestrationV2CheckpointScope) =>
        checkpoints
          .capture({
            scope,
            ordinalWithinScope: 1,
            runId: scope.runId!,
            nodeId: scope.nodeId!,
            appRunOrdinal: 1,
            capturedAt: scope.createdAt,
          })
          .pipe(Effect.forkChild);
      // A baseline's short budget running out says nothing about a post-turn capture.
      const baseline = yield* checkpoints
        .captureBaseline({ scope: scopeFor("baseline"), ordinalWithinScope: 0 })
        .pipe(Effect.result, Effect.forkChild);
      yield* Queue.take(started);
      const afterBaseline = yield* captureTurn(scopeFor("after-baseline"));
      yield* TestClock.adjust("5 seconds");
      yield* Fiber.join(baseline);
      yield* Queue.take(started);
      yield* TestClock.adjust("30 seconds");
      assert.strictEqual((yield* Fiber.join(afterBaseline)).status, "error");
      assert.strictEqual(yield* Ref.get(attempts), 2);

      const first = yield* captureTurn(scopeFor("first"));
      yield* Queue.take(started);
      // Other threads in the same folder finish their turns while the first capture hangs.
      const waiting = [
        yield* captureTurn(scopeFor("second")),
        yield* captureTurn(scopeFor("third")),
      ];
      // A thread's root capture first materializes its baseline, which waits on the lock too.
      const root = scopeFor("root");
      const rootWaiting = yield* Effect.gen(function* () {
        const capturesBeforeLock = yield* checkpoints.capturesSoFar(root.cwd);
        yield* checkpoints.materializeBaselineCheckpoint({
          scope: root,
          ordinalWithinScope: 0,
          nodeId: root.nodeId!,
          capturedAt: root.createdAt,
        });
        return yield* checkpoints.capture({
          scope: root,
          ordinalWithinScope: 1,
          runId: root.runId!,
          nodeId: root.nodeId!,
          appRunOrdinal: 1,
          capturedAt: root.createdAt,
          capturesBeforeLock,
        });
      }).pipe(Effect.forkChild);
      yield* TestClock.adjust("30 seconds");
      assert.strictEqual((yield* Fiber.join(first)).status, "error");
      // Room for every waiter to probe, so the count below is what fails without the fix.
      yield* TestClock.adjust("90 seconds");
      for (const fiber of waiting) {
        assert.strictEqual((yield* Fiber.join(fiber)).status, "error");
      }
      assert.strictEqual((yield* Fiber.join(rootWaiting)).status, "error");
      assert.strictEqual(yield* Ref.get(attempts), 3, "each waiter spent its own full timeout");

      // A capture that starts after the timeout still probes for recovery.
      const later = yield* captureTurn(scopeFor("later"));
      yield* TestClock.adjust("30 seconds");
      assert.strictEqual((yield* Fiber.join(later)).status, "error");
      assert.strictEqual(yield* Ref.get(attempts), 4);

      // A success ahead in the queue does not hide a timeout that follows it.
      yield* Ref.set(script, ["ready", "timeout"]);
      const recovered = yield* captureTurn(scopeFor("recovered"));
      const relapsed = yield* captureTurn(scopeFor("relapsed"));
      const queuedBehind = yield* captureTurn(scopeFor("queued-behind"));
      yield* TestClock.adjust("90 seconds");
      assert.deepEqual(
        [
          (yield* Fiber.join(recovered)).status,
          (yield* Fiber.join(relapsed)).status,
          (yield* Fiber.join(queuedBehind)).status,
        ],
        ["ready", "error", "error"],
      );
      assert.strictEqual(yield* Ref.get(attempts), 6, "the waiter probed after a later timeout");
    }).pipe(Effect.provide(layerTest));
  }),
);
