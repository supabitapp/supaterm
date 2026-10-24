import {
  ChatAttachment,
  CommandId,
  EnvironmentId,
  MessageId,
  ModelSelection,
  OrchestrationMessageContext,
  OrchestrationV2CreationSource,
  PlanId,
  ProjectId,
  ProviderInteractionMode,
  RunId,
  RuntimeMode,
  SnapShotSource,
  PastedTextAttachmentSource,
  ThreadId,
  UploadChatAttachment,
} from "@supaterm/contracts";
import * as Schema from "effect/Schema";

const CreateThread = Schema.Struct({
  projectId: ProjectId,
  title: Schema.String,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  branch: Schema.NullOr(Schema.String),
  worktreePath: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
});

export const OutboxTurnInput = Schema.Struct({
  commandId: CommandId,
  threadId: ThreadId,
  createdAt: Schema.optionalKey(Schema.String),
  creationSource: Schema.optionalKey(OrchestrationV2CreationSource),
  manualContinuationOfRunId: Schema.optionalKey(RunId),
  message: Schema.Struct({
    messageId: MessageId,
    role: Schema.Literal("user"),
    text: Schema.String,
    attachments: Schema.Array(Schema.Union([ChatAttachment, UploadChatAttachment])),
    context: Schema.optionalKey(OrchestrationMessageContext),
  }),
  modelSelection: Schema.optionalKey(ModelSelection),
  titleSeed: Schema.optionalKey(Schema.String),
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  dispatchMode: Schema.optionalKey(Schema.Literals(["auto", "queue", "steer", "restart", "start"])),
  sourceProposedPlan: Schema.optionalKey(Schema.Struct({ threadId: ThreadId, planId: PlanId })),
  bootstrap: Schema.optionalKey(
    Schema.Struct({
      createThread: Schema.optionalKey(CreateThread),
      prepareWorktree: Schema.optionalKey(
        Schema.Struct({
          requireWorktree: Schema.optionalKey(Schema.Boolean),
          projectCwd: Schema.String,
          baseBranch: Schema.String,
          branch: Schema.optionalKey(Schema.String),
          startFromOrigin: Schema.optionalKey(Schema.Boolean),
        }),
      ),
      runSetupScript: Schema.optionalKey(Schema.Boolean),
    }),
  ),
});

export const OutboxAttachment = Schema.Struct({
  id: Schema.String,
  type: Schema.Literals(["image", "file"]),
  name: Schema.String,
  mimeType: Schema.String,
  sizeBytes: Schema.Number,
  bytes: Schema.NullOr(Schema.instanceOf(Blob)),
  source: Schema.optionalKey(Schema.Union([SnapShotSource, PastedTextAttachmentSource])),
  uploaded: Schema.optionalKey(ChatAttachment),
});

export const OutboxTurnVoice = Schema.Struct({
  clipId: Schema.String,
  bytes: Schema.NullOr(Schema.instanceOf(Blob)),
  mimeType: Schema.String,
  durationMs: Schema.Number,
  locale: Schema.NullOr(Schema.String),
  insertAt: Schema.Number,
  capturedAt: Schema.String,
  sourceId: Schema.NullOr(Schema.String),
  transcript: Schema.optionalKey(Schema.String),
});

export const OutboxTurn = Schema.Struct({
  environmentId: EnvironmentId,
  input: OutboxTurnInput,
  localAttachments: Schema.Array(OutboxAttachment),
  pendingWorktree: Schema.optionalKey(
    Schema.Struct({
      projectCwd: Schema.String,
      requireWorktree: Schema.optionalKey(Schema.Boolean),
      startFromOrigin: Schema.optionalKey(Schema.Boolean),
    }),
  ),
  branch: Schema.optionalKey(Schema.String),
  draftId: Schema.optionalKey(Schema.String),
  background: Schema.optionalKey(Schema.Boolean),
  voice: Schema.optionalKey(OutboxTurnVoice),
});
export type OutboxTurn = typeof OutboxTurn.Type;

export const StoredOutboxEntry = Schema.Struct({
  schemaVersion: Schema.Literals([1, 2, 3]),
  id: Schema.String,
  scope: Schema.String,
  createdAt: Schema.String,
  position: Schema.Number,
  payload: OutboxTurn,
  status: Schema.Literals(["pending", "failed", "delivered"]),
  attempted: Schema.Boolean,
  attempts: Schema.Number,
  retryAt: Schema.Number,
  error: Schema.NullOr(Schema.String),
  paused: Schema.Boolean,
  pauseUntil: Schema.Number,
});

export function encodeStoredOutboxEntry(
  entry: Omit<typeof StoredOutboxEntry.Type, "schemaVersion">,
) {
  return {
    schemaVersion: entry.payload.voice === undefined ? (2 as const) : (3 as const),
    ...entry,
  };
}
