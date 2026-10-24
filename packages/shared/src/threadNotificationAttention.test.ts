import {
  type OrchestrationV2PendingRuntimeRequestSummary,
  type OrchestrationV2ThreadShell,
  ProjectId,
  ProviderInstanceId,
  RunId,
  RuntimeRequestId,
  ThreadId,
} from "@supaterm/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import {
  threadNotificationAttention,
  threadNotificationAttentionByThread,
} from "./threadNotificationAttention.ts";

const now = DateTime.makeUnsafe("2026-10-21T00:00:00.000Z");
const providerInstanceId = ProviderInstanceId.make("codex");
const parentId = ThreadId.make("parent");
const runId = RunId.make("run-1");

function thread(overrides: Partial<OrchestrationV2ThreadShell> = {}): OrchestrationV2ThreadShell {
  return {
    id: parentId,
    projectId: ProjectId.make("project"),
    title: "Thread",
    providerInstanceId,
    modelSelection: { instanceId: providerInstanceId, model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    activeProviderThreadId: null,
    lineage: { rootThreadId: parentId, parentThreadId: null, relationshipToParent: null },
    forkedFrom: null,
    createdBy: "user",
    creationSource: "web",
    latestRunId: runId,
    activeRunId: null,
    status: "completed",
    pendingRuntimeRequest: null,
    latestVisibleMessage: null,
    latestUserMessageAt: null,
    hasActionableProposedPlan: false,
    itemCount: 1,
    visibleItemCount: 1,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    doneOverride: null,
    doneAt: null,
    lastVisitedAt: null,
    deletedAt: null,
    ...overrides,
  };
}

const request = (
  kind: OrchestrationV2PendingRuntimeRequestSummary["kind"],
  id = "request-1",
  blocking?: boolean,
): OrchestrationV2PendingRuntimeRequestSummary => ({
  id: RuntimeRequestId.make(id),
  kind,
  createdAt: now,
  ...(blocking === undefined ? {} : { blocking }),
});

const running = { status: "running", activityRunStatus: "running" } as const;

function child(id: string, parent: ThreadId, overrides: Partial<OrchestrationV2ThreadShell> = {}) {
  return thread({
    id: ThreadId.make(id),
    lineage: { rootThreadId: parentId, parentThreadId: parent, relationshipToParent: "subagent" },
    creationSource: "mcp",
    ...running,
    ...overrides,
  });
}

describe("threadNotificationAttention", () => {
  it("asks for approval on a provider approval request, even mid-run", () => {
    expect(
      threadNotificationAttention(
        thread({ ...running, pendingRuntimeRequest: request("command") }),
      ),
    ).toEqual({
      kind: "approval",
      key: "approval:request-1",
      sourceThreadId: parentId,
      requestId: "request-1",
    });
  });

  it.each(["auth_refresh", "dynamic_tool_call"] as const)("never alerts for %s", (kind) => {
    expect(
      threadNotificationAttention(thread({ ...running, pendingRuntimeRequest: request(kind) })),
    ).toBeNull();
  });

  it("asks for input on a blocking question, and on an async one once the run stops", () => {
    expect(
      threadNotificationAttention(
        thread({ ...running, pendingRuntimeRequest: request("user_input") }),
      ),
    ).toEqual({
      kind: "input",
      key: "input:request-1",
      sourceThreadId: parentId,
      requestId: "request-1",
    });
    const asyncQuestion = request("user_input", "request-1", false);
    expect(
      threadNotificationAttention(thread({ ...running, pendingRuntimeRequest: asyncQuestion })),
    ).toBeNull();
    expect(
      threadNotificationAttention(
        thread({ status: "waiting", pendingRuntimeRequest: asyncQuestion }),
      )?.key,
    ).toBe("input:request-1");
  });

  it("reports a finished run once per run", () => {
    expect(threadNotificationAttention(thread())).toEqual({
      kind: "completion",
      key: "completion:run-1",
      sourceThreadId: parentId,
      runId,
    });
    expect(threadNotificationAttention(thread({ latestRunId: RunId.make("run-2") }))?.key).toBe(
      "completion:run-2",
    );
    expect(threadNotificationAttention(thread({ latestRunId: null }))).toBeNull();
  });

  it.each([
    ["running", { ...running }],
    ["draining effects", { status: "waiting" }],
    ["interrupted", { status: "interrupted" }],
    ["cancelled", { status: "cancelled" }],
  ] as const)("stays quiet while %s", (_case, overrides) => {
    expect(threadNotificationAttention(thread(overrides))).toBeNull();
  });

  it("holds completion while background work will wake the agent, but not a command", () => {
    expect(
      threadNotificationAttention(
        thread({ pendingBackgroundTasks: [{ taskId: "task", kind: "subagent" }] }),
      ),
    ).toBeNull();
    expect(
      threadNotificationAttention(
        thread({ pendingBackgroundTasks: [{ taskId: "task", kind: "command" }] }),
      )?.kind,
    ).toBe("completion");
  });

  it("splits failures from usage limits", () => {
    expect(
      threadNotificationAttention(thread({ status: "failed", lastErrorClass: "provider_error" })),
    ).toEqual({ kind: "failure", key: "failure:run-1", sourceThreadId: parentId, runId });
    expect(
      threadNotificationAttention(
        thread({
          status: "failed",
          lastErrorClass: "usage_limit",
          pendingBackgroundTasks: [{ taskId: "task", kind: "subagent" }],
        }),
      )?.key,
    ).toBe("usage-limit:run-1");
  });

  it("skips archived, deleted, and subagent threads", () => {
    expect(threadNotificationAttention(thread({ archivedAt: now }))).toBeNull();
    expect(threadNotificationAttention(thread({ deletedAt: now }))).toBeNull();
    expect(
      threadNotificationAttention(
        child("child", parentId, { status: "completed", activityRunStatus: null }),
      ),
    ).toBeNull();
  });
});

describe("threadNotificationAttentionByThread", () => {
  it("lifts a live subagent approval to its top-level ancestor", () => {
    const parent = thread(running);
    const middle = child("middle", parentId);
    const leaf = child("leaf", middle.id, {
      pendingRuntimeRequest: request("file-change", "leaf-request"),
    });
    const attention = threadNotificationAttentionByThread([parent, middle, leaf]);
    expect(attention.get(parentId)).toEqual({
      kind: "approval",
      key: "approval:leaf:leaf-request",
      sourceThreadId: leaf.id,
      requestId: "leaf-request",
    });
    expect(attention.has(middle.id)).toBe(false);
    expect(attention.has(leaf.id)).toBe(false);
  });

  it("prefers a subagent approval over a sibling's question", () => {
    const attention = threadNotificationAttentionByThread([
      thread(running),
      child("asks", parentId, { pendingRuntimeRequest: request("user_input", "question") }),
      child("approves", parentId, { pendingRuntimeRequest: request("command", "approval") }),
    ]);
    expect(attention.get(parentId)?.key).toBe("approval:approves:approval");
  });

  it("lets the parent's own request win over a lifted one", () => {
    const attention = threadNotificationAttentionByThread([
      thread({ ...running, pendingRuntimeRequest: request("command", "own") }),
      child("approves", parentId, { pendingRuntimeRequest: request("command", "child") }),
    ]);
    expect(attention.get(parentId)?.key).toBe("approval:own");
  });

  it.each([
    [
      "a finished subagent's leftover question",
      {
        activityRunStatus: null,
        status: "completed",
        pendingRuntimeRequest: request("user_input"),
      },
    ],
    [
      "a provider-native subagent",
      { creationSource: "provider", pendingRuntimeRequest: request("command") },
    ],
    ["a dynamic tool call", { pendingRuntimeRequest: request("dynamic_tool_call") }],
  ] as const)("ignores %s", (_case, overrides) => {
    const attention = threadNotificationAttentionByThread([
      thread(running),
      child("child", parentId, overrides),
    ]);
    expect(attention.size).toBe(0);
  });
});
