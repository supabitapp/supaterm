import {
  type OrchestrationV2ThreadShell,
  type ThreadId,
  userInputAutoDismissAt,
} from "@supaterm/contracts";
import type { PushNotificationKind } from "@supaterm/contracts/push";
import {
  liftSubagentRequests,
  type ThreadNotificationAttention,
  type ThreadNotificationRequestAttention,
  threadNotificationAttention,
} from "@supaterm/shared/threadNotificationAttention";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";

export interface PushThreadAttentionState {
  /** The top-level thread that notifies; subagent requests are lifted onto it. */
  readonly thread: OrchestrationV2ThreadShell;
  readonly attention: ThreadNotificationAttention | null;
}

export const isRequestKind = (kind: PushNotificationKind) =>
  kind === "approval" || kind === "input";

export const isRequestAttention = (
  attention: ThreadNotificationAttention,
): attention is ThreadNotificationRequestAttention => isRequestKind(attention.kind);

const SETTLED_SUBAGENT_STATUSES = new Set(["completed", "failed", "cancelled", "interrupted"]);
const MAX_SUBAGENT_DEPTH = 8;

export class PushAttention extends Context.Service<
  PushAttention,
  {
    /** Attention of the top-level thread that `threadId` belongs to, or null when it is gone. */
    readonly forThread: (
      threadId: ThreadId,
    ) => Effect.Effect<PushThreadAttentionState | null, ProjectionStore.ProjectionStoreV2Error>;
    /** The text `full` previews show after the kind label. */
    readonly detail: (
      state: PushThreadAttentionState,
    ) => Effect.Effect<string | null, ProjectionStore.ProjectionStoreV2Error>;
    /** When an unanswered question dismisses itself, in epoch milliseconds. */
    readonly requestDeadline: (
      attention: ThreadNotificationRequestAttention,
    ) => Effect.Effect<number | null, ProjectionStore.ProjectionStoreV2Error>;
  }
>()("supaterm/notifications/PushAttention") {}

const make = Effect.gen(function* () {
  const projections = yield* ProjectionStore.ProjectionStoreV2;

  // Children are read through delegated-task records, which index by parent; settled ones
  // cannot hold a live request because the classifier requires an active child run.
  const liveDescendants = Effect.fnUntraced(function* (root: OrchestrationV2ThreadShell) {
    const shells: Array<OrchestrationV2ThreadShell> = [];
    const seen = new Set<ThreadId>([root.id]);
    let frontier: ReadonlyArray<ThreadId> = [root.id];
    for (let depth = 0; depth < MAX_SUBAGENT_DEPTH && frontier.length > 0; depth += 1) {
      const next: Array<ThreadId> = [];
      for (const parentId of frontier) {
        const { subagents } = yield* projections.getThreadRecords(parentId, ["subagents"]);
        for (const subagent of subagents) {
          const childId = subagent.childThreadId;
          if (
            childId === null ||
            seen.has(childId) ||
            subagent.origin !== "app_owned" ||
            SETTLED_SUBAGENT_STATUSES.has(subagent.status)
          ) {
            continue;
          }
          seen.add(childId);
          const child = yield* projections.getThreadShell(childId);
          if (child === null) continue;
          shells.push(child);
          next.push(childId);
        }
      }
      frontier = next;
    }
    return shells;
  });

  const forThread: PushAttention["Service"]["forThread"] = Effect.fn("PushAttention.forThread")(
    function* (threadId) {
      let thread = yield* projections.getThreadShell(threadId);
      const seen = new Set<ThreadId>();
      while (
        thread !== null &&
        thread.lineage.relationshipToParent === "subagent" &&
        thread.lineage.parentThreadId !== null &&
        !seen.has(thread.id)
      ) {
        seen.add(thread.id);
        thread = yield* projections.getThreadShell(thread.lineage.parentThreadId);
      }
      if (thread === null || thread.lineage.relationshipToParent === "subagent") return null;
      if (thread.archivedAt !== null || thread.deletedAt !== null) {
        return { thread, attention: null };
      }
      const descendants = yield* liveDescendants(thread);
      const lifted =
        descendants.length === 0
          ? null
          : (liftSubagentRequests([thread, ...descendants]).get(thread.id) ?? null);
      return { thread, attention: threadNotificationAttention(thread, lifted) };
    },
  );

  const detail: PushAttention["Service"]["detail"] = Effect.fn("PushAttention.detail")(function* ({
    thread,
    attention,
  }) {
    if (attention === null) return null;
    switch (attention.kind) {
      case "completion": {
        // Shells leave message bodies out, so the run's reply comes from the message projection.
        const { messages } = yield* projections.getThreadRecords(
          attention.sourceThreadId,
          ["messages"],
          { messageRoles: ["assistant"], messageRunIds: [attention.runId] },
        );
        let latest: (typeof messages)[number] | undefined;
        for (const message of messages) {
          if (message.text.trim().length === 0) continue;
          if (
            latest === undefined ||
            DateTime.toEpochMillis(message.updatedAt) > DateTime.toEpochMillis(latest.updatedAt)
          ) {
            latest = message;
          }
        }
        return latest?.text ?? null;
      }
      case "failure":
      case "usage-limit":
        return thread.lastError ?? null;
      case "approval":
      case "input": {
        const { turnItems } = yield* projections.getThreadRecords(
          attention.sourceThreadId,
          ["turnItems"],
          { turnItemTypes: ["approval_request", "user_input_request"] },
        );
        for (const item of turnItems) {
          if (item.type === "approval_request" && item.requestId === attention.requestId) {
            return item.prompt ?? null;
          }
          if (item.type === "user_input_request" && item.requestId === attention.requestId) {
            return item.questions.map((question) => question.question).join(" ") || null;
          }
        }
        return null;
      }
    }
  });

  const requestDeadline: PushAttention["Service"]["requestDeadline"] = Effect.fn(
    "PushAttention.requestDeadline",
  )(function* (attention) {
    const request = yield* projections.getRuntimeRequest(
      attention.sourceThreadId,
      attention.requestId,
    );
    const deadline = request === undefined ? null : userInputAutoDismissAt(request);
    return deadline === null ? null : DateTime.toEpochMillis(deadline);
  });

  return PushAttention.of({ forThread, detail, requestDeadline });
});

export const layer = Layer.effect(PushAttention, make);
