import {
  groupThreadOutboxMessages,
  flattenThreadOutboxMessages,
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
  type ServerProviderModel,
} from "@supaterm/contracts";
import * as Schema from "effect/Schema";

import { DraftComposerAttachmentSchema } from "../lib/composer-image-schema";
import { withImplicitFastModeSelection } from "../lib/providerOptions";
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
  repositories: Schema.optional(Schema.Array(Schema.String)),
  startsFromRepositoryDefaults: Schema.optional(Schema.Boolean),
});

const QueuedThreadMessageSchema = Schema.Struct({
  schemaVersion: Schema.Literals([1, 2, 3, 4, THREAD_OUTBOX_SCHEMA_VERSION]),
  environmentId: EnvironmentId,
  threadId: ThreadId,
  messageId: MessageId,
  commandId: CommandId,
  text: Schema.String,
  restoreToDraft: Schema.optional(Schema.Boolean),
  context: Schema.optional(OrchestrationMessageContext),
  attachments: Schema.Array(DraftComposerAttachmentSchema),
  modelSelection: Schema.optional(ModelSelection),
  dispatchMode: Schema.optional(Schema.Literals(["auto", "queue", "steer", "restart"])),
  freshContext: Schema.optional(Schema.Boolean),
  runtimeMode: Schema.optional(RuntimeMode),
  interactionMode: Schema.optional(ProviderInteractionMode),
  creation: Schema.optional(QueuedThreadCreationSchema),
  // Builds that transcribed on the environment queued voice rows and held refused transcripts;
  // neither is sent without the user, so both are skipped.
  voice: Schema.optional(Schema.Unknown),
  failure: Schema.optional(Schema.Unknown),
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
  /** Tracked repositories the new worktree takes, by path; absent leaves the choice to the server. */
  readonly repositories?: ReadonlyArray<string>;
  /** The project folder is no Git repository, so a new worktree needs no base branch. */
  readonly startsFromRepositoryDefaults?: boolean;
}

export interface QueuedThreadMessage {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly messageId: MessageId;
  readonly commandId: CommandId;
  readonly text: string;
  readonly restoreToDraft?: boolean;
  readonly context?: OrchestrationMessageContext;
  readonly attachments: ReadonlyArray<DraftComposerAttachment>;
  readonly modelSelection?: ModelSelectionType;
  readonly runtimeMode?: RuntimeModeType;
  readonly interactionMode?: ProviderInteractionModeType;
  /**
   * Captured at enqueue time because the drain can fire long after the tap.
   */
  readonly dispatchMode?: ComposerDispatchMode;
  /** Starts a new provider session (`/clear`). */
  readonly freshContext?: boolean;
  readonly creation?: QueuedThreadCreation;
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
  providers: ReadonlyArray<
    Pick<ServerProvider, "instanceId" | "showInteractionModeToggle"> & {
      readonly models: ReadonlyArray<Pick<ServerProviderModel, "slug" | "capabilities">>;
    }
  > = [],
): ThreadSettingsSnapshot {
  const modelSelection = withImplicitFastModeSelection(
    message.modelSelection ?? thread.modelSelection,
    providers,
  );
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

export function decodeQueuedThreadMessage(value: unknown): QueuedThreadMessage | null {
  const { schemaVersion: _, voice, failure, ...message } = decodeStoredQueuedThreadMessage(value);
  return voice === undefined && failure === undefined ? message : null;
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
    message.creation.useDefaultBranch === true ||
    message.creation.startsFromRepositoryDefaults === true
  );
}

export type AcknowledgedThreadMessage = QueuedThreadMessage & {
  /** The server sequence that committed the message; older servers do not report it. */
  readonly sequence?: number;
};
