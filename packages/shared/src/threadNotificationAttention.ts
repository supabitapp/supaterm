import type {
  OrchestrationV2PendingRuntimeRequestSummary,
  OrchestrationV2ThreadShell,
  RunId,
  RuntimeRequestId,
  ThreadId,
} from "@supaterm/contracts";
import { isProviderNativeSubagentThread } from "@supaterm/contracts";
import type { PushNotificationKind } from "@supaterm/contracts/push";

import { backgroundWorkHoldsCompletion } from "./orchestrationV2PendingBackgroundWork.ts";

type RuntimeRequestKind = OrchestrationV2PendingRuntimeRequestSummary["kind"];

/**
 * Auth refreshes resolve without the user, and no live adapter emits dynamic tool
 * calls, so neither asks the user for an approval.
 */
export function runtimeRequestNeedsApproval(kind: RuntimeRequestKind): boolean {
  return kind !== "user_input" && kind !== "auth_refresh" && kind !== "dynamic_tool_call";
}

export interface SubagentRequest {
  readonly kind: "approval" | "user_input";
  readonly threadId: ThreadId;
  readonly requestId: RuntimeRequestId;
}

type SubagentRequestInput = Pick<
  OrchestrationV2ThreadShell,
  "id" | "lineage" | "creationSource" | "pendingRuntimeRequest" | "activityRunStatus"
>;

// An async question outlives the subagent's run, but once that run ends the
// parent is no longer waiting on the answer, so it stops counting as input.
// The activity run stays set when a follow-up is queued behind a blocked run.
// Provider-native subagents ask on their parent, so they are skipped.
export function liveSubagentRequest(thread: SubagentRequestInput): SubagentRequest | null {
  const request = thread.pendingRuntimeRequest;
  if (
    request === null ||
    thread.lineage.relationshipToParent !== "subagent" ||
    isProviderNativeSubagentThread(thread) ||
    thread.activityRunStatus == null
  ) {
    return null;
  }
  if (request.kind === "user_input") {
    return { kind: "user_input", threadId: thread.id, requestId: request.id };
  }
  return runtimeRequestNeedsApproval(request.kind)
    ? { kind: "approval", threadId: thread.id, requestId: request.id }
    : null;
}

const EMPTY_SUBAGENT_REQUESTS: ReadonlyMap<ThreadId, SubagentRequest> = new Map();

/** Lifts each live subagent request to every ancestor; an approval outranks a question. */
export function liftSubagentRequests<T extends SubagentRequestInput>(
  threads: ReadonlyArray<T>,
): ReadonlyMap<ThreadId, SubagentRequest> {
  const requests = new Map<ThreadId, SubagentRequest>();
  let byId: ReadonlyMap<ThreadId, T> | undefined;
  for (const child of threads) {
    const request = liveSubagentRequest(child);
    if (request === null) continue;
    byId ??= new Map(threads.map((thread) => [thread.id, thread] as const));
    const seen = new Set<ThreadId>([child.id]);
    let current: T | undefined = child;
    while (current?.lineage.relationshipToParent === "subagent") {
      const parentId: ThreadId | null = current.lineage.parentThreadId;
      if (parentId === null || seen.has(parentId)) break;
      seen.add(parentId);
      if (requests.get(parentId)?.kind !== "approval") requests.set(parentId, request);
      current = byId.get(parentId);
    }
  }
  return requests.size === 0 ? EMPTY_SUBAGENT_REQUESTS : requests;
}

export type ThreadNotificationAttentionInput = Pick<
  OrchestrationV2ThreadShell,
  | "id"
  | "archivedAt"
  | "deletedAt"
  | "lineage"
  | "latestRunId"
  | "activeProviderThreadId"
  | "pendingRuntimeRequest"
  | "activityRunStatus"
  | "status"
  | "lastErrorClass"
  | "pendingBackgroundTasks"
>;

export type ThreadNotificationRequestAttention = {
  readonly kind: Extract<PushNotificationKind, "approval" | "input">;
  /** Changes whenever a new occurrence needs the user, so a transition is a key change. */
  readonly key: string;
  /** The thread that asked: the notifying thread, or a subagent whose request was lifted. */
  readonly sourceThreadId: ThreadId;
  readonly requestId: RuntimeRequestId;
};

type ThreadNotificationRunAttention = {
  readonly kind: Exclude<PushNotificationKind, "approval" | "input">;
  readonly key: string;
  readonly sourceThreadId: ThreadId;
  readonly runId: RunId;
};

export type ThreadNotificationAttention =
  | ThreadNotificationRequestAttention
  | ThreadNotificationRunAttention;

/** Attention for a request `sourceThreadId` asked, notifying on `threadId`. */
export function requestAttention(
  kind: ThreadNotificationRequestAttention["kind"],
  threadId: ThreadId,
  sourceThreadId: ThreadId,
  requestId: RuntimeRequestId,
): ThreadNotificationRequestAttention {
  const key =
    sourceThreadId === threadId ? `${kind}:${requestId}` : `${kind}:${sourceThreadId}:${requestId}`;
  return { kind, key, sourceThreadId, requestId };
}

export function runAttention(
  kind: ThreadNotificationRunAttention["kind"],
  threadId: ThreadId,
  runId: RunId,
): ThreadNotificationRunAttention {
  return { kind, key: `${kind}:${runId}`, sourceThreadId: threadId, runId };
}

/** Which notification a pending request of this kind asks for, if any. */
export function runtimeRequestAttentionKind(
  kind: RuntimeRequestKind,
): ThreadNotificationRequestAttention["kind"] | null {
  if (kind === "user_input") return "input";
  return runtimeRequestNeedsApproval(kind) ? "approval" : null;
}

// Mirrors the client's shell runtime: background work that wakes the agent
// parks a finished run at idle instead of completed.
function runtimeStatus(thread: ThreadNotificationAttentionInput) {
  const parkedAtIdle =
    backgroundWorkHoldsCompletion(thread.pendingBackgroundTasks ?? []) &&
    thread.status !== "failed";
  if (thread.latestRunId === null && thread.activeProviderThreadId === null && !parkedAtIdle) {
    return null;
  }
  return parkedAtIdle ? "idle" : (thread.activityRunStatus ?? thread.status);
}

/**
 * What a thread needs from the user, if anything. Subagents never notify for
 * themselves; pass the request lifted from `liftSubagentRequests` for their parent.
 */
export function threadNotificationAttention(
  thread: ThreadNotificationAttentionInput,
  subagent: SubagentRequest | null = null,
): ThreadNotificationAttention | null {
  if (
    thread.archivedAt !== null ||
    thread.deletedAt !== null ||
    thread.lineage.relationshipToParent === "subagent"
  ) {
    return null;
  }
  const status = runtimeStatus(thread);
  const request = thread.pendingRuntimeRequest;
  if (request !== null && runtimeRequestNeedsApproval(request.kind)) {
    return requestAttention("approval", thread.id, thread.id, request.id);
  }
  if (subagent?.kind === "approval") {
    return requestAttention("approval", thread.id, subagent.threadId, subagent.requestId);
  }
  const working = status === "preparing" || status === "starting" || status === "running";
  // A non-blocking question only waits on the user once the run stops working past it.
  if (request?.kind === "user_input" && (request.blocking !== false || !working)) {
    return requestAttention("input", thread.id, thread.id, request.id);
  }
  if (subagent?.kind === "user_input") {
    return requestAttention("input", thread.id, subagent.threadId, subagent.requestId);
  }
  if (thread.latestRunId === null) return null;
  if (status === "failed") {
    const kind = thread.lastErrorClass === "usage_limit" ? "usage-limit" : "failure";
    return runAttention(kind, thread.id, thread.latestRunId);
  }
  return status === "completed" ? runAttention("completion", thread.id, thread.latestRunId) : null;
}

/** Attention for every top-level thread that needs the user, keyed by thread. */
export function threadNotificationAttentionByThread<
  T extends ThreadNotificationAttentionInput & SubagentRequestInput,
>(threads: ReadonlyArray<T>): ReadonlyMap<ThreadId, ThreadNotificationAttention> {
  const lifted = liftSubagentRequests(threads);
  const attention = new Map<ThreadId, ThreadNotificationAttention>();
  for (const thread of threads) {
    const value = threadNotificationAttention(thread, lifted.get(thread.id) ?? null);
    if (value !== null) attention.set(thread.id, value);
  }
  return attention;
}
