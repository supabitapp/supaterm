import {
  CheckpointId,
  CheckpointRef,
  CheckpointScopeId,
  EnvironmentId,
  NodeId,
  ProviderDriverKind,
  RuntimeRequestId,
  TurnItemId,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2TurnItem,
  ThreadId,
  RunId,
  MessageId,
  type ScopedThreadRef,
} from "@supaterm/contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { describe, expect, it } from "vite-plus/test";

import { v2Projection, v2Now, v2ThreadId } from "./orchestrationV2TestFixtures.ts";
import { EMPTY_THREAD_HISTORY_META } from "./threadHistoryMerge.ts";
import { createEnvironmentThreadDetailAtoms, sameThreadStructure } from "./threadDetail.ts";
import { EMPTY_ENVIRONMENT_THREAD_STATE } from "./threadState.ts";
import type { EnvironmentThreadState } from "./threads.ts";

const ref: ScopedThreadRef = {
  environmentId: EnvironmentId.make("environment-detail"),
  threadId: ThreadId.make(v2Projection.thread.id),
};

function threadState(
  partial: Pick<EnvironmentThreadState, "data" | "status" | "error"> &
    Partial<Pick<EnvironmentThreadState, "history">>,
): EnvironmentThreadState {
  return { ...partial, history: partial.history ?? EMPTY_THREAD_HISTORY_META };
}

describe("createEnvironmentThreadDetailAtoms", () => {
  it("adds environment scope while preserving the pristine projection", () => {
    const initial: AsyncResult.AsyncResult<EnvironmentThreadState, never> = AsyncResult.success(
      threadState({
        data: Option.some(v2Projection),
        status: "cached",
        error: Option.none(),
      }),
    );
    const sourceAtom = Atom.make(initial);
    const details = createEnvironmentThreadDetailAtoms(() => sourceAtom);
    const registry = AtomRegistry.make();

    const thread = registry.get(details.threadAtom(ref));
    expect(thread).toEqual({ environmentId: ref.environmentId, projection: v2Projection });
    expect(thread?.projection).toBe(v2Projection);
    expect(registry.get(details.visibleTurnItemsAtom(ref))).toBe(v2Projection.visibleTurnItems);
    expect(registry.get(details.statusAtom(ref))).toBe("cached");
    expect(registry.get(details.historyAtom(ref))).toBe(EMPTY_THREAD_HISTORY_META);

    registry.set(
      sourceAtom,
      AsyncResult.success(
        threadState({
          data: Option.some(v2Projection),
          status: "synchronizing",
          error: Option.none(),
        }),
      ),
    );

    expect(registry.get(details.threadAtom(ref))).toBe(thread);
    expect(registry.get(details.statusAtom(ref))).toBe("synchronizing");

    const progressiveHistory = {
      ...EMPTY_THREAD_HISTORY_META,
      historyCursor: "cursor-1",
      hasMoreHistory: true,
    };
    registry.set(
      sourceAtom,
      AsyncResult.success(
        threadState({
          data: Option.some(v2Projection),
          status: "live",
          error: Option.some("Stream interrupted."),
          history: progressiveHistory,
        }),
      ),
    );

    expect(registry.get(details.threadAtom(ref))).toBe(thread);
    expect(registry.get(details.visibleTurnItemsAtom(ref))).toBe(v2Projection.visibleTurnItems);
    expect(registry.get(details.statusAtom(ref))).toBe("live");
    expect(registry.get(details.errorAtom(ref))).toBe("Stream interrupted.");
    expect(registry.get(details.historyAtom(ref))).toBe(progressiveHistory);

    registry.set(
      sourceAtom,
      AsyncResult.success(
        threadState({
          data: Option.none(),
          status: "deleted",
          error: Option.none(),
        }),
      ),
    );

    expect(registry.get(details.threadAtom(ref))).toBeNull();
    expect(registry.get(details.visibleTurnItemsAtom(ref))).toEqual([]);
    expect(registry.get(details.statusAtom(ref))).toBe("deleted");
    expect(registry.get(details.errorAtom(ref))).toBeNull();
    expect(registry.get(details.historyAtom(ref))).toBe(EMPTY_THREAD_HISTORY_META);
    registry.dispose();
  });
});

it("does not notify queue consumers for streaming text or execution nodes", () => {
  const projection = {
    ...v2Projection,
    runs: [
      {
        id: RunId.make("queued-run"),
        threadId: v2Projection.thread.id,
        ordinal: 1,
        providerInstanceId: v2Projection.thread.providerInstanceId,
        modelSelection: v2Projection.thread.modelSelection,
        providerThreadId: null,
        userMessageId: MessageId.make("queued-message"),
        rootNodeId: null,
        activeAttemptId: null,
        status: "queued" as const,
        requestedAt: v2Now,
        startedAt: null,
        completedAt: null,
        checkpointId: null,
        contextHandoffId: null,
      },
    ],
  };
  const source = Atom.make(
    AsyncResult.success(
      threadState({ data: Option.some(projection), status: "live", error: Option.none() }),
    ),
  );
  const details = createEnvironmentThreadDetailAtoms(() => source);
  const registry = AtomRegistry.make();
  const dispose = registry.mount(details.queueWorkflowAtom(ref));
  const before = registry.get(details.queueWorkflowAtom(ref));
  const disposeCount = registry.mount(details.queuedCountAtom(ref));
  expect(registry.get(details.queuedCountAtom(ref))).toBe(1);
  registry.set(
    source,
    AsyncResult.success(
      threadState({
        data: Option.some({
          ...projection,
          nodes: [...v2Projection.nodes],
          turnItems: [...v2Projection.turnItems],
        }),
        status: "live",
        error: Option.none(),
      }),
    ),
  );
  expect(registry.get(details.queueWorkflowAtom(ref))).toBe(before);
  expect(registry.get(details.queuedCountAtom(ref))).toBe(1);
  registry.set(
    source,
    AsyncResult.success(
      threadState({ data: Option.none(), status: "deleted", error: Option.none() }),
    ),
  );
  expect(registry.get(details.queueWorkflowAtom(ref))).toBeNull();
  expect(registry.get(details.queuedCountAtom(ref))).toBe(0);
  disposeCount();
  dispose();
  registry.dispose();
});

it("does not notify the agents pill for unrelated projection updates", () => {
  const projection: OrchestrationV2ThreadProjection = {
    ...v2Projection,
    runs: [
      {
        id: RunId.make("active-run"),
        threadId: v2Projection.thread.id,
        ordinal: 1,
        providerInstanceId: v2Projection.thread.providerInstanceId,
        modelSelection: v2Projection.thread.modelSelection,
        providerThreadId: null,
        userMessageId: MessageId.make("message"),
        rootNodeId: null,
        activeAttemptId: null,
        status: "running" as const,
        requestedAt: v2Now,
        startedAt: v2Now,
        completedAt: null,
        checkpointId: null,
        contextHandoffId: null,
      },
    ],
    subagents: [
      {
        id: NodeId.make("subagent-1"),
        threadId: v2Projection.thread.id,
        runId: RunId.make("active-run"),
        parentNodeId: NodeId.make("root"),
        origin: "app_owned",
        createdBy: "agent",
        driver: ProviderDriverKind.make("codex"),
        providerInstanceId: v2Projection.thread.providerInstanceId,
        providerThreadId: null,
        childThreadId: ThreadId.make("thread-child"),
        nativeTaskRef: null,
        prompt: "Do the thing",
        title: "Worker",
        model: null,
        status: "running",
        result: null,
        startedAt: v2Now,
        completedAt: null,
        updatedAt: v2Now,
      },
    ],
  };
  const source = Atom.make(
    AsyncResult.success(
      threadState({ data: Option.some(projection), status: "live", error: Option.none() }),
    ),
  );
  const details = createEnvironmentThreadDetailAtoms(() => source);
  const registry = AtomRegistry.make();
  const dispose = registry.mount(details.turnSubagentsAtom(ref));
  const before = registry.get(details.turnSubagentsAtom(ref));
  expect(before?.liveCount).toBe(1);
  registry.set(
    source,
    AsyncResult.success(
      threadState({
        data: Option.some({ ...projection, turnItems: [...v2Projection.turnItems] }),
        status: "live",
        error: Option.none(),
      }),
    ),
  );
  expect(registry.get(details.turnSubagentsAtom(ref))).toBe(before);
  dispose();
  registry.dispose();
});

it("keeps worktree and pending requests stable during output updates, then reflects resolution", () => {
  const projection: OrchestrationV2ThreadProjection = {
    ...v2Projection,
    thread: { ...v2Projection.thread, worktreePath: "/workspace/task" },
    runtimeRequests: [
      {
        id: RuntimeRequestId.make("approval"),
        nodeId: NodeId.make("approval-node"),
        providerTurnId: null,
        nativeRequestRef: null,
        kind: "command",
        status: "pending",
        responseCapability: { type: "not_resumable", reason: "Provider exited" },
        createdAt: v2Now,
        resolvedAt: null,
      },
    ],
  };
  const source = Atom.make(
    AsyncResult.success(
      threadState({ data: Option.some(projection), status: "live", error: Option.none() }),
    ),
  );
  const details = createEnvironmentThreadDetailAtoms(() => source);
  const registry = AtomRegistry.make();
  const dispose = registry.mount(details.pendingRequestsAtom(ref));
  const before = registry.get(details.pendingRequestsAtom(ref));
  expect(before?.approvals).toHaveLength(1);
  const streaming: OrchestrationV2ThreadProjection = {
    ...projection,
    turnItems: [
      {
        id: TurnItemId.make("output"),
        threadId: projection.thread.id,
        runId: null,
        nodeId: null,
        providerThreadId: null,
        providerTurnId: null,
        nativeItemRef: null,
        parentItemId: null,
        ordinal: 1,
        status: "running",
        title: null,
        startedAt: v2Now,
        completedAt: null,
        updatedAt: v2Now,
        type: "command_execution",
        input: "pwd",
        output: "new output",
        exitCode: undefined,
      },
    ],
  };
  registry.set(
    source,
    AsyncResult.success(
      threadState({ data: Option.some(streaming), status: "live", error: Option.none() }),
    ),
  );
  expect(registry.get(details.pendingRequestsAtom(ref))).toBe(before);
  expect(registry.get(details.worktreePathAtom(ref))).toBe("/workspace/task");
  registry.set(
    source,
    AsyncResult.success(
      threadState({
        data: Option.some({
          ...streaming,
          thread: { ...projection.thread, worktreePath: "/workspace/moved" },
          runtimeRequests: projection.runtimeRequests.map((request) => ({
            ...request,
            status: "resolved",
            resolvedAt: v2Now,
          })),
        }),
        status: "live",
        error: Option.none(),
      }),
    ),
  );
  expect(registry.get(details.pendingRequestsAtom(ref))?.approvals).toEqual([]);
  expect(registry.get(details.worktreePathAtom(ref))).toBe("/workspace/moved");
  dispose();
  registry.dispose();
});

it("rebuilds checkpoint summaries only when checkpoints or messages change", () => {
  const checkpoint: OrchestrationV2ThreadProjection["checkpoints"][number] = {
    id: CheckpointId.make("checkpoint-1"),
    threadId: v2Projection.thread.id,
    scopeId: CheckpointScopeId.make("scope-1"),
    runId: RunId.make("run-1"),
    nodeId: NodeId.make("node-1"),
    parentCheckpointId: null,
    ordinalWithinScope: 1,
    appRunOrdinal: 1,
    ref: CheckpointRef.make("ref-1"),
    status: "ready",
    files: [],
    capturedAt: v2Now,
  };
  const projection: OrchestrationV2ThreadProjection = {
    ...v2Projection,
    checkpoints: [checkpoint],
  };
  const live = (data: OrchestrationV2ThreadProjection | null) =>
    AsyncResult.success(
      threadState({ data: Option.fromNullishOr(data), status: "live", error: Option.none() }),
    );
  const sourceAtom = Atom.make(live(projection));
  const details = createEnvironmentThreadDetailAtoms(() => sourceAtom);
  const registry = AtomRegistry.make();
  const dispose = registry.mount(details.checkpointSummariesAtom(ref));

  const summaries = registry.get(details.checkpointSummariesAtom(ref));
  expect(summaries.map((summary) => summary.runId)).toEqual(["run-1"]);

  registry.set(sourceAtom, live({ ...projection, runs: [] }));
  expect(registry.get(details.checkpointSummariesAtom(ref))).toBe(summaries);

  registry.set(sourceAtom, live({ ...projection, checkpoints: [] }));
  expect(registry.get(details.checkpointSummariesAtom(ref))).toEqual([]);

  registry.set(sourceAtom, live(null));
  expect(registry.get(details.checkpointSummariesAtom(ref))).toEqual([]);
  dispose();
  registry.dispose();
});

const later = DateTime.makeUnsafe("2026-06-20T00:00:01.000Z");

const assistant: OrchestrationV2TurnItem = {
  id: TurnItemId.make("item-assistant"),
  threadId: v2ThreadId,
  runId: RunId.make("run-1"),
  nodeId: null,
  providerThreadId: null,
  providerTurnId: null,
  nativeItemRef: null,
  parentItemId: null,
  ordinal: 1,
  status: "running",
  title: null,
  startedAt: v2Now,
  completedAt: null,
  updatedAt: v2Now,
  type: "assistant_message",
  messageId: MessageId.make("message-assistant"),
  text: "Hel",
  streaming: true,
};

function withItem(item: OrchestrationV2TurnItem, updatedAt = v2Now) {
  return {
    ...v2Projection,
    turnItems: [item],
    visibleTurnItems: [
      {
        position: 0,
        visibility: "local" as const,
        sourceThreadId: v2ThreadId,
        sourceItemId: item.id,
        item,
      },
    ],
    updatedAt,
  };
}

describe("sameThreadStructure", () => {
  const before = withItem(assistant);

  it("holds through streamed text", () => {
    const next = withItem({ ...assistant, text: "Hello", updatedAt: later }, later);
    expect(sameThreadStructure(before, next)).toBe(true);
  });

  it("sees the item finish streaming", () => {
    const next = withItem({ ...assistant, text: "Hello", streaming: false, status: "completed" });
    expect(sameThreadStructure(before, next)).toBe(false);
  });

  it("sees a new item", () => {
    const next = { ...before, turnItems: [assistant, { ...assistant, id: TurnItemId.make("b") }] };
    expect(sameThreadStructure(before, next)).toBe(false);
  });

  it("sees other fields change on a streaming item", () => {
    const next = withItem({ ...assistant, text: "Hello", title: "Answer" });
    expect(sameThreadStructure(before, next)).toBe(false);
  });

  it("holds through a visit mark", () => {
    const thread = { ...before.thread, lastVisitedAt: later, updatedAt: later };
    expect(sameThreadStructure(before, { ...before, thread })).toBe(true);
  });

  it("sees other thread changes", () => {
    const thread = { ...before.thread, title: "Renamed" };
    expect(sameThreadStructure(before, { ...before, thread })).toBe(false);
  });

  it("sees changes outside the turn items", () => {
    expect(sameThreadStructure(before, { ...before, runs: [] })).toBe(false);
  });
});

describe("lastVisitedAtAtom", () => {
  it("follows a visit mark the quiet thread holds through", () => {
    const projection = withItem(assistant);
    const state = Atom.make(
      AsyncResult.success({ ...EMPTY_ENVIRONMENT_THREAD_STATE, data: Option.some(projection) }),
    );
    const details = createEnvironmentThreadDetailAtoms(() => state);
    const ref = { environmentId: EnvironmentId.make("env"), threadId: v2ThreadId };
    const registry = AtomRegistry.make();
    const unmountQuiet = registry.mount(details.quietThreadAtom(ref));
    const unmountVisit = registry.mount(details.lastVisitedAtAtom(ref));
    const quietBefore = registry.get(details.quietThreadAtom(ref));

    const visited = { ...projection, thread: { ...projection.thread, lastVisitedAt: later } };
    registry.set(
      state,
      AsyncResult.success({ ...EMPTY_ENVIRONMENT_THREAD_STATE, data: Option.some(visited) }),
    );

    expect(registry.get(details.quietThreadAtom(ref))).toBe(quietBefore);
    expect(registry.get(details.lastVisitedAtAtom(ref))).toBe(later);
    unmountQuiet();
    unmountVisit();
    registry.dispose();
  });
});

describe("quietThreadAtom", () => {
  const ref = { environmentId: EnvironmentId.make("environment-1"), threadId: v2ThreadId };

  function setup(initial: OrchestrationV2ThreadProjection) {
    const stateAtom = Atom.make(
      AsyncResult.success({ ...EMPTY_ENVIRONMENT_THREAD_STATE, data: Option.some(initial) }),
    );
    const quietAtom = createEnvironmentThreadDetailAtoms(() => stateAtom).quietThreadAtom(ref);
    const registry = AtomRegistry.make();
    registry.mount(quietAtom);
    return {
      read: () => registry.get(quietAtom),
      push: (projection: OrchestrationV2ThreadProjection) =>
        registry.set(
          stateAtom,
          AsyncResult.success({ ...EMPTY_ENVIRONMENT_THREAD_STATE, data: Option.some(projection) }),
        ),
    };
  }

  it("keeps the same value through streamed text", () => {
    const thread = setup(withItem(assistant));
    const first = thread.read();
    thread.push(withItem({ ...assistant, text: "Hello", updatedAt: later }, later));
    thread.push(withItem({ ...assistant, text: "Hello there", updatedAt: later }, later));
    expect(thread.read()).toBe(first);
  });

  it("passes a structure change on", () => {
    const thread = setup(withItem(assistant));
    const first = thread.read();
    thread.push(withItem({ ...assistant, text: "Hello", updatedAt: later }, later));
    thread.push(withItem({ ...assistant, text: "Hello", status: "completed", streaming: false }));
    const next = thread.read();
    expect(next).not.toBe(first);
    expect(next?.projection.turnItems[0]).toMatchObject({ status: "completed", streaming: false });
  });

  it("leaves out the fields that streaming moves", () => {
    const thread = setup(withItem(assistant));
    const projection = thread.read()?.projection;
    expect(projection).not.toHaveProperty("updatedAt");
    expect(projection?.thread).not.toHaveProperty("updatedAt");
    expect(projection?.thread).not.toHaveProperty("lastVisitedAt");
    expect(projection?.turnItems[0]).not.toHaveProperty("text");
    expect(projection?.turnItems[0]).not.toHaveProperty("updatedAt");
    expect(projection?.visibleTurnItems[0]?.item).not.toHaveProperty("text");
    expect(projection?.visibleTurnItems[0]?.item).toMatchObject({
      messageId: assistant.messageId,
      streaming: true,
    });
  });
});
