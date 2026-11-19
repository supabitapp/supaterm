import type {
  EnvironmentId,
  MessageId,
  ModelSelection,
  OrchestrationMessageContext,
  OrchestrationV2CreationSource,
  ProjectId,
  ProviderInteractionMode,
  RuntimeMode,
  ThreadId,
} from "@supaterm/contracts";
import * as DateTime from "effect/DateTime";

import { presentThreadShell } from "./state/shell.ts";

export interface PendingCreationMessage {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly messageId: MessageId;
  readonly text: string;
  readonly context?: OrchestrationMessageContext | undefined;
  readonly createdAt: string;
}

export type PendingThreadCreationOutcome<Message> =
  | { readonly kind: "delivered"; readonly message: Message }
  | { readonly kind: "failed"; readonly message: Message; readonly reason: string };

export type PendingThreadCreation<Message> = {
  readonly message: Message;
  readonly outcome: PendingThreadCreationOutcome<Message> | null;
};

/** Retain the local conversation through delivery until the server owns its first turn. */
export function resolvePendingThreadCreation<Message extends PendingCreationMessage>(input: {
  readonly threadKey: string | null;
  readonly pending: PendingThreadCreation<Message> | null;
  readonly previous: PendingThreadCreation<Message> | null;
  readonly detail: {
    readonly messages: ReadonlyArray<{ readonly id: string }>;
    readonly runs?: ReadonlyArray<{ readonly status: string }>;
    readonly latestTurn?: { readonly turnId: string } | null;
    readonly session?: { readonly status: string } | null;
  } | null;
}): PendingThreadCreation<Message> | null {
  const creation = input.pending ?? input.previous;
  if (
    creation === null ||
    `${creation.message.environmentId}:${creation.message.threadId}` !== input.threadKey
  )
    return null;
  if (creation.outcome?.kind === "failed") return creation;
  const detail = input.detail;
  const latestRun = detail?.runs?.at(-1);
  const terminalStatus = latestRun?.status ?? detail?.session?.status;
  if (
    terminalStatus === "failed" ||
    terminalStatus === "error" ||
    terminalStatus === "cancelled" ||
    terminalStatus === "stopped" ||
    terminalStatus === "interrupted"
  )
    return null;
  if (
    detail !== null &&
    (latestRun !== undefined || detail.latestTurn != null) &&
    !isPendingThreadCreationVisible({
      creationMessageId: creation.message.messageId,
      loadedMessageIds: detail.messages.map((message) => message.id),
    })
  )
    return null;
  return creation;
}

/** A shell can arrive before its prompt; only the matching message retires the local row. */
export function isPendingThreadCreationVisible(input: {
  readonly creationMessageId: string;
  readonly loadedMessageIds: ReadonlyArray<string> | null;
}): boolean {
  return !input.loadedMessageIds?.includes(input.creationMessageId);
}

export function pendingThreadCreationMessage(message: PendingCreationMessage) {
  return {
    id: message.messageId,
    role: "user" as const,
    text: message.text,
    context: message.context,
    runId: null,
    streaming: false,
    createdAt: message.createdAt,
    updatedAt: message.createdAt,
  };
}

/** Presentation only: never insert this shell into the server's authoritative state. */
export function buildPendingThreadShell(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
  readonly branch: string | null;
  readonly worktreePath: string | null;
  readonly createdAt: string;
  readonly creationSource: OrchestrationV2CreationSource;
}) {
  const timestamp = DateTime.makeUnsafe(input.createdAt);
  return presentThreadShell(input.environmentId, {
    id: input.threadId,
    projectId: input.projectId,
    title: input.title,
    providerInstanceId: input.modelSelection.instanceId,
    modelSelection: input.modelSelection,
    runtimeMode: input.runtimeMode,
    interactionMode: input.interactionMode,
    branch: input.branch,
    worktreePath: input.worktreePath,
    pullRequests: [],
    linkedPullRequest: null,
    branchPullRequest: null,
    lineage: { rootThreadId: input.threadId, parentThreadId: null, relationshipToParent: null },
    forkedFrom: null,
    createdBy: "user",
    creationSource: input.creationSource,
    activeProviderThreadId: null,
    latestRunId: null,
    activeRunId: null,
    status: "preparing",
    pendingRuntimeRequest: null,
    latestVisibleMessage: null,
    latestUserMessageAt: timestamp,
    hasActionableProposedPlan: false,
    itemCount: 0,
    visibleItemCount: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    archivedAt: null,
    doneOverride: null,
    doneAt: null,
    reopenedAt: null,
    snoozedUntil: null,
    snoozedAt: null,
    pinnedAt: null,
    pinOrderKey: null,
    activeOrderKey: null,
    deletedAt: null,
  });
}

export function pendingThreadCreationLabel(input: {
  readonly connected: boolean;
  readonly preparingWorktree: boolean;
}): string {
  if (!input.connected) return "Waiting for connection";
  return input.preparingWorktree ? "Setting up worktree…" : "Starting…";
}
