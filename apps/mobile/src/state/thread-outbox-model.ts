import {
  groupThreadOutboxMessages,
  flattenThreadOutboxMessages,
  shouldRetryThreadOutboxDelivery,
} from "@supaterm/client-runtime/thread-outbox";
export {
  shouldRetryThreadOutboxDelivery,
  threadOutboxRetryDelayMs,
} from "@supaterm/client-runtime/thread-outbox";
export {
  resolveThreadOutboxDeliveryAction,
  resolveThreadOutboxDispatchStep,
  resolveThreadOutboxFailureAction,
  type ThreadOutboxCommandStage,
  type ThreadOutboxFailureAction,
} from "@supaterm/client-runtime/thread-outbox";
import {
  CommandId,
  EnvironmentId,
  IsoDateTime,
  MessageId,
  ModelSelection,
  NonNegativeInt,
  OrchestrationMessageContext,
  ProjectId,
  ProviderInteractionMode,
  RuntimeMode,
  ThreadId,
  type ModelSelection as ModelSelectionType,
  type ProjectId as ProjectIdType,
  type ProviderInteractionMode as ProviderInteractionModeType,
  type RuntimeMode as RuntimeModeType,
  type ServerProvider,
} from "@supaterm/contracts";
import * as Schema from "effect/Schema";
import { VoiceUploadError } from "@supaterm/client-runtime/state/transcription";
import type { TranscriptionUploadResult } from "@supaterm/contracts";

import { DraftComposerAttachmentSchema } from "../lib/composer-image-schema";
import type { ComposerDispatchMode } from "@supaterm/client-runtime/state/composer-dispatch";
import type { DraftComposerAttachment } from "../lib/composerImages";
import { resolveProviderInteractionMode } from "./provider-interaction-mode";

const THREAD_OUTBOX_SCHEMA_VERSION = 5;

const QueuedThreadCreationSchema = Schema.Struct({
  projectId: ProjectId,
  projectTitle: Schema.optional(Schema.String),
  projectCwd: Schema.optional(Schema.String),
  workspaceMode: Schema.Literals(["local", "worktree"]),
  branch: Schema.NullOr(Schema.String),
  useDefaultBranch: Schema.optional(Schema.Literal(true)),
  worktreePath: Schema.NullOr(Schema.String),
  startFromOrigin: Schema.optional(Schema.Boolean),
  pullRequestReference: Schema.optional(Schema.String),
});

const QueuedVoiceRecordingSchema = Schema.Struct({
  durationMs: NonNegativeInt,
  sizeBytes: NonNegativeInt,
  language: Schema.String,
});

const QueuedThreadMessageSchema = Schema.Struct({
  schemaVersion: Schema.Literals([1, 2, 3, 4, THREAD_OUTBOX_SCHEMA_VERSION]),
  environmentId: EnvironmentId,
  threadId: ThreadId,
  messageId: MessageId,
  commandId: CommandId,
  text: Schema.String,
  context: Schema.optional(OrchestrationMessageContext),
  attachments: Schema.Array(DraftComposerAttachmentSchema),
  modelSelection: Schema.optional(ModelSelection),
  dispatchMode: Schema.optional(Schema.Literals(["auto", "queue", "steer", "restart"])),
  runtimeMode: Schema.optional(RuntimeMode),
  interactionMode: Schema.optional(ProviderInteractionMode),
  creation: Schema.optional(QueuedThreadCreationSchema),
  voice: Schema.optional(QueuedVoiceRecordingSchema),
  failure: Schema.optional(Schema.String),
  createdAt: IsoDateTime,
});

const decodeStoredQueuedThreadMessage = Schema.decodeUnknownSync(QueuedThreadMessageSchema);
const encodeStoredQueuedThreadMessage = Schema.encodeUnknownSync(QueuedThreadMessageSchema);

export interface QueuedThreadCreation {
  readonly projectId: ProjectIdType;
  readonly projectTitle?: string;
  readonly projectCwd?: string;
  readonly workspaceMode: "local" | "worktree";
  readonly branch: string | null;
  readonly useDefaultBranch?: true;
  readonly worktreePath: string | null;
  readonly startFromOrigin?: boolean;
  readonly pullRequestReference?: string;
}

/** A recording the environment transcribes and sends as the message; its text stays empty. */
export interface QueuedVoiceRecording {
  readonly durationMs: number;
  readonly sizeBytes: number;
  /** BCP 47, captured when recorded. */
  readonly language: string;
}

export interface QueuedThreadMessage {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly messageId: MessageId;
  readonly commandId: CommandId;
  readonly text: string;
  readonly context?: OrchestrationMessageContext;
  readonly attachments: ReadonlyArray<DraftComposerAttachment>;
  readonly modelSelection?: ModelSelectionType;
  readonly runtimeMode?: RuntimeModeType;
  readonly interactionMode?: ProviderInteractionModeType;
  /**
   * Captured at enqueue time because the drain can fire long after the tap.
   */
  readonly dispatchMode?: ComposerDispatchMode;
  readonly creation?: QueuedThreadCreation;
  /** Its audio lives in `thread-outbox-audio/<messageId>.wav` until delivery or discard. */
  readonly voice?: QueuedVoiceRecording;
  /**
   * Why delivery stopped where only the user can continue it. The entry holds its thread's
   * queue until they retry or discard it.
   */
  readonly failure?: string;
  readonly createdAt: string;
}

export interface ThreadSettingsSnapshot {
  readonly modelSelection: ModelSelectionType;
  readonly runtimeMode: RuntimeModeType;
  readonly interactionMode: ProviderInteractionModeType;
}

export function resolveQueuedThreadSettings(
  message: QueuedThreadMessage,
  thread: ThreadSettingsSnapshot,
  providers: ReadonlyArray<Pick<ServerProvider, "instanceId" | "showInteractionModeToggle">> = [],
): ThreadSettingsSnapshot {
  const modelSelection = message.modelSelection ?? thread.modelSelection;
  const provider = providers.find(
    (candidate) => candidate.instanceId === modelSelection.instanceId,
  );
  return {
    modelSelection,
    runtimeMode: message.runtimeMode ?? thread.runtimeMode,
    interactionMode: resolveProviderInteractionMode(
      provider,
      message.interactionMode ?? thread.interactionMode,
    ),
  };
}

export function modelSelectionsEqual(left: ModelSelectionType, right: ModelSelectionType): boolean {
  return (
    left.instanceId === right.instanceId &&
    left.model === right.model &&
    JSON.stringify(left.options ?? null) === JSON.stringify(right.options ?? null)
  );
}

export function encodeQueuedThreadMessage(message: QueuedThreadMessage): unknown {
  return encodeStoredQueuedThreadMessage({
    schemaVersion: THREAD_OUTBOX_SCHEMA_VERSION,
    ...message,
  });
}

export function decodeQueuedThreadMessage(value: unknown): QueuedThreadMessage {
  const { schemaVersion: _, ...message } = decodeStoredQueuedThreadMessage(value);
  return message;
}

export function groupQueuedThreadMessages(
  messages: ReadonlyArray<QueuedThreadMessage>,
): Record<string, ReadonlyArray<QueuedThreadMessage>> {
  return groupThreadOutboxMessages(messages, (message) => message);
}

export const flattenQueuedThreadMessages = flattenThreadOutboxMessages<QueuedThreadMessage>;

/**
 * Whether follow-ups wait behind a pending task. They are queued on the task's
 * machine, so the task cannot move to another one without stranding them.
 */
export function hasQueuedFollowUps(
  queues: Readonly<Record<string, ReadonlyArray<QueuedThreadMessage>>>,
  creation: QueuedThreadMessage,
): boolean {
  return (queues[`${creation.environmentId}:${creation.threadId}`] ?? []).some(
    (message) => message.creation === undefined,
  );
}

export function isQueuedThreadCreationSendable(message: QueuedThreadMessage): boolean {
  if (!message.creation) {
    return false;
  }
  const hasContent = message.text.trim().length > 0 || message.attachments.length > 0;
  if (!hasContent || message.modelSelection === undefined) {
    return false;
  }
  return (
    message.creation.workspaceMode !== "worktree" ||
    Boolean(message.creation.branch) ||
    message.creation.useDefaultBranch === true
  );
}

export type VoiceDeliveryStep =
  | { readonly step: "delivered"; readonly transcript: string }
  /** Waits for the user. `message` replaces the queued entry. */
  | { readonly step: "hold"; readonly message: QueuedThreadMessage }
  | { readonly step: "retry" };

/**
 * Every hold takes a fresh command id: nothing was dispatched under the old one, and the
 * server keeps that id's failed outcome, so a retry under it would only replay the failure.
 * Failures that may pass keep the ids, so the next attempt joins the server's work.
 */
export function resolveVoiceDeliveryStep(
  message: QueuedThreadMessage,
  outcome: { readonly result: TranscriptionUploadResult } | { readonly error: unknown },
  nextCommandId: () => CommandId,
): VoiceDeliveryStep {
  const hold = (failure: string, transcript?: string): VoiceDeliveryStep => {
    if (transcript === undefined) {
      return { step: "hold", message: { ...message, commandId: nextCommandId(), failure } };
    }
    const { voice: _, ...text } = message;
    return {
      step: "hold",
      message: { ...text, text: transcript, commandId: nextCommandId(), failure },
    };
  };
  if ("error" in outcome) {
    const { error } = outcome;
    if (error instanceof VoiceUploadError) {
      return error.retryable ? { step: "retry" } : hold(error.message);
    }
    return shouldRetryThreadOutboxDelivery(error)
      ? { step: "retry" }
      : hold(error instanceof Error ? error.message : "The recording couldn't be sent.");
  }
  const { text, submission } = outcome.result;
  if (submission?.status === "sent") return { step: "delivered", transcript: text };
  if (submission?.status === "noSpeech" || text.trim().length === 0) {
    return hold("No speech was detected.");
  }
  return hold("Transcribed, but the message couldn't be sent. Edit it or try again.", text);
}
