import { assert, it } from "@effect/vitest";
import {
  ContextTransferId,
  isForkableSourceRunStatus,
  MessageId,
  type ModelSelection,
  type OrchestrationV2AppThread,
  type OrchestrationV2Run,
  type OrchestrationV2ThreadProjection,
  ProjectId,
  ProviderInstanceId,
  ProviderThreadId,
  RunId,
  ThreadId,
} from "@supaterm/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import * as ThreadForkService from "./ThreadForkService.ts";

const sourceThreadId = ThreadId.make("thread:fork-snoozed-source");
const targetThreadId = ThreadId.make("thread:fork-awake-target");
const sourceRunId = RunId.make("run:fork-snoozed-source");
const providerInstanceId = ProviderInstanceId.make("codex");
const modelSelection = {
  instanceId: providerInstanceId,
  model: "gpt-5.4",
} satisfies ModelSelection;
const sourceCreatedAt = DateTime.makeUnsafe("2026-07-24T09:00:00.000Z");
const snoozedAt = DateTime.makeUnsafe("2026-07-24T09:05:00.000Z");
const snoozedUntil = DateTime.makeUnsafe("2026-07-25T09:00:00.000Z");
const forkCreatedAt = DateTime.makeUnsafe("2026-07-24T09:10:00.000Z");

function makeSourceThread(): OrchestrationV2AppThread {
  return {
    createdBy: "user",
    creationSource: "web",
    id: sourceThreadId,
    projectId: ProjectId.make("project:fork-snooze"),
    title: "Snoozed source",
    providerInstanceId,
    modelSelection,
    runtimeMode: "full-access",
    interactionMode: "plan",
    branch: "feature/source",
    worktreePath: "/tmp/source-worktree",
    activeProviderThreadId: ProviderThreadId.make("provider-thread:fork-snoozed-source"),
    lineage: {
      parentThreadId: null,
      relationshipToParent: null,
      rootThreadId: sourceThreadId,
    },
    forkedFrom: null,
    createdAt: sourceCreatedAt,
    updatedAt: snoozedAt,
    archivedAt: null,
    doneOverride: null,
    doneAt: null,
    lastVisitedAt: null,
    snoozedUntil,
    snoozedAt,
    deletedAt: null,
  };
}

function makeSourceRun(status: OrchestrationV2Run["status"]): OrchestrationV2Run {
  return {
    id: sourceRunId,
    threadId: sourceThreadId,
    ordinal: 1,
    providerInstanceId,
    modelSelection,
    providerThreadId: ProviderThreadId.make("provider-thread:fork-snoozed-source"),
    userMessageId: MessageId.make("message:fork-snoozed-source"),
    rootNodeId: null,
    activeAttemptId: null,
    status,
    queuePosition: null,
    requestedAt: sourceCreatedAt,
    startedAt: sourceCreatedAt,
    completedAt: snoozedAt,
    checkpointId: null,
    contextHandoffId: null,
  };
}

function makeSourceProjection(
  sourceRun: OrchestrationV2Run,
  thread: OrchestrationV2AppThread,
): OrchestrationV2ThreadProjection {
  return {
    thread,
    runs: [sourceRun],
    attempts: [],
    nodes: [],
    subagents: [],
    providerSessions: [],
    providerThreads: [],
    providerTurns: [],
    runtimeRequests: [],
    messages: [],
    plans: [],
    turnItems: [],
    checkpointScopes: [],
    checkpoints: [],
    contextHandoffs: [],
    contextTransfers: [],
    visibleTurnItems: [],
    updatedAt: snoozedAt,
  };
}

const planFork = (
  sourceRun: OrchestrationV2Run,
  sourceThread = makeSourceThread(),
  options: Pick<
    Parameters<ThreadForkService.ThreadForkServiceV2Shape["plan"]>[0],
    "sideChat" | "runtimeMode" | "liveSnapshot"
  > = {},
) =>
  Effect.gen(function* () {
    const service = yield* ThreadForkService.ThreadForkServiceV2;
    return yield* service.plan({
      sourceProjection: makeSourceProjection(sourceRun, sourceThread),
      sourceRun,
      sourceProviderThread: undefined,
      canonicalSourcePoint: {
        threadId: sourceThreadId,
        runId: sourceRunId,
      },
      transferId: ContextTransferId.make("context-transfer:fork-snoozed-source"),
      targetThreadId,
      title: "Awake fork",
      ...options,
      createdBy: "user",
      creationSource: "mobile",
      createdAt: forkCreatedAt,
    });
  }).pipe(Effect.provide(ThreadForkService.layer));

it("treats usage-limited and other provider-finished runs as forkable", () => {
  assert.isTrue(isForkableSourceRunStatus("completed"));
  assert.isTrue(isForkableSourceRunStatus("waiting"));
  assert.isTrue(isForkableSourceRunStatus("failed"));
  assert.isTrue(isForkableSourceRunStatus("interrupted"));
  assert.isTrue(isForkableSourceRunStatus("cancelled"));
  assert.isFalse(isForkableSourceRunStatus("running"));
  assert.isFalse(isForkableSourceRunStatus("starting"));
  assert.isFalse(isForkableSourceRunStatus("queued"));
  assert.isFalse(isForkableSourceRunStatus("preparing"));
  assert.isFalse(isForkableSourceRunStatus("rolled_back"));
});

it.effect("keeps a fork awake when its source thread is snoozed", () =>
  Effect.gen(function* () {
    const sourceThread = makeSourceThread();
    const sourceRun = makeSourceRun("completed");
    const result = yield* planFork(sourceRun);

    assert.isNull(result.targetThread.snoozedUntil);
    assert.isNull(result.targetThread.snoozedAt);
    assert.equal(result.targetThread.projectId, sourceThread.projectId);
    assert.equal(result.targetThread.providerInstanceId, sourceThread.providerInstanceId);
    assert.deepEqual(result.targetThread.modelSelection, sourceThread.modelSelection);
    assert.equal(result.targetThread.runtimeMode, sourceThread.runtimeMode);
    assert.equal(result.targetThread.interactionMode, sourceThread.interactionMode);
    assert.equal(result.targetThread.branch, sourceThread.branch);
    assert.equal(result.targetThread.worktreePath, sourceThread.worktreePath);
    assert.isNull(result.targetThread.activeProviderThreadId);
    assert.deepEqual(result.targetThread.lineage, {
      parentThreadId: sourceThreadId,
      relationshipToParent: "fork",
      rootThreadId: sourceThreadId,
    });
    assert.deepEqual(result.targetThread.forkedFrom, {
      type: "run",
      threadId: sourceThreadId,
      runId: sourceRunId,
    });
  }),
);

it.effect("leaves the source's watches behind, so only the source is woken", () =>
  Effect.gen(function* () {
    const startedAt = "2026-07-24T09:05:00.000Z";
    const result = yield* planFork(makeSourceRun("completed"), {
      ...makeSourceThread(),
      pullRequests: [
        {
          host: "github.com",
          repository: "supabitapp/supacode-next",
          number: 7,
          url: "https://github.com/supabitapp/supacode-next/pull/7",
          source: "agent",
          linkedAt: startedAt,
          snapshot: null,
          stack: null,
          watch: {
            startedAt,
            headSha: null,
            failedChecks: [],
            passed: false,
            passedChecks: [],
            remarksThrough: startedAt,
            remarkIds: [],
            conflicting: false,
            wakes: 0,
          },
        },
      ],
      workflowRunWatches: [
        {
          host: "github.com",
          repository: "supabitapp/supacode-next",
          runId: 42,
          name: "CI",
          url: null,
          startedAt,
        },
      ],
    });
    assert.equal(result.targetThread.pullRequests?.[0]?.number, 7);
    assert.isUndefined(result.targetThread.pullRequests?.[0]?.watch);
    assert.deepEqual(result.targetThread.workflowRunWatches, []);
  }),
);

it.effect("rejects in-progress and rolled-back fork sources", () =>
  Effect.gen(function* () {
    for (const status of ["running", "rolled_back"] as const) {
      const sourceRun = makeSourceRun(status);
      const error = yield* planFork(sourceRun).pipe(Effect.flip);
      assert.equal(error._tag, "ThreadForkPlanError");
      assert.equal(error.sourceThreadId, sourceThreadId);
      assert.equal(error.targetThreadId, targetThreadId);
      assert.equal(error.cause, ThreadForkService.forkableSourceRunStatusError(sourceRun));
    }
  }),
);

it.effect("marks a side chat from the command, never from its source", () =>
  Effect.gen(function* () {
    const sideChat = yield* planFork(makeSourceRun("completed"), makeSourceThread(), {
      sideChat: true,
      runtimeMode: "approval-required",
    });
    assert.isTrue(sideChat.targetThread.sideChat);
    assert.equal(sideChat.targetThread.runtimeMode, "approval-required");

    const promotedAt = DateTime.makeUnsafe("2026-07-24T09:06:00.000Z");
    const ordinaryFork = yield* planFork(makeSourceRun("completed"), {
      ...makeSourceThread(),
      sideChat: true,
      sideChatPromotedAt: promotedAt,
    });
    assert.isUndefined(ordinaryFork.targetThread.sideChat);
    assert.isUndefined(ordinaryFork.targetThread.sideChatPromotedAt);
    assert.equal(ordinaryFork.targetThread.runtimeMode, "full-access");
  }),
);

it.effect("records a live snapshot of a run still in progress", () =>
  Effect.gen(function* () {
    const result = yield* planFork(makeSourceRun("running"), makeSourceThread(), {
      liveSnapshot: true,
    });
    assert.equal(result.transfer.snapshot, "live");
    assert.isUndefined(result.transfer.sourceTokenUsage);

    const stable = yield* planFork(makeSourceRun("completed"));
    assert.isUndefined(stable.transfer.snapshot);
  }),
);
