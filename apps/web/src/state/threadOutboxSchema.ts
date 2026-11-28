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
  freshContext: Schema.optionalKey(Schema.Boolean),
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
          repositories: Schema.optionalKey(Schema.Array(Schema.Struct({ path: Schema.String }))),
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

export const OutboxTurn = Schema.Struct({
  environmentId: EnvironmentId,
  input: OutboxTurnInput,
  localAttachments: Schema.Array(OutboxAttachment),
  pendingWorktree: Schema.optionalKey(
    Schema.Struct({
      projectCwd: Schema.String,
      requireWorktree: Schema.optionalKey(Schema.Boolean),
      startFromOrigin: Schema.optionalKey(Schema.Boolean),
      repositories: Schema.optionalKey(Schema.Array(Schema.Struct({ path: Schema.String }))),
    }),
  ),
  branch: Schema.optionalKey(Schema.String),
  draftId: Schema.optionalKey(Schema.String),
  linkPullRequestUrl: Schema.optionalKey(Schema.String),
  background: Schema.optionalKey(Schema.Boolean),
});
export type OutboxTurn = typeof OutboxTurn.Type;

export const StoredOutboxEntry = Schema.Struct({
  schemaVersion: Schema.Literals([1, 2]),
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
  return { schemaVersion: 2 as const, ...entry };
}

const legacyVoiceRecordingId = (entryId: string) => `${entryId}:voice`;

/** Retrying would send the recovered recording with no words for the agent to read. */
export function holdsOnlyLegacyVoiceRecording(entry: {
  readonly id: string;
  readonly payload: OutboxTurn;
}): boolean {
  return (
    entry.payload.input.message.text.trim() === "" &&
    entry.payload.localAttachments.some(
      (attachment) => attachment.id === legacyVoiceRecordingId(entry.id),
    )
  );
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Version 3 held a voice message for the environment to transcribe, which it no longer does. It
 * comes back as a failed, paused message holding the recording, so nothing is lost or sent empty.
 */
export function migrateLegacyVoiceEntry(value: unknown, error: string): unknown {
  if (!isRecord(value) || !isRecord(value.payload) || !isRecord(value.payload.voice)) return value;
  const { voice, ...payload } = value.payload;
  // An acknowledged turn only waits for its row to be removed; cleanup finishes it.
  if (value.status === "delivered") return { ...value, schemaVersion: 2, payload };
  const attachments = Array.isArray(payload.localAttachments) ? payload.localAttachments : [];
  const recording =
    voice.audio instanceof Blob
      ? [
          {
            id: legacyVoiceRecordingId(String(value.id)),
            type: "file",
            name: "Voice message.wav",
            mimeType: "audio/wav",
            sizeBytes: voice.audio.size,
            bytes: voice.audio,
          },
        ]
      : [];
  return {
    ...value,
    schemaVersion: 2,
    payload: { ...payload, localAttachments: [...attachments, ...recording] },
    status: "failed",
    error,
    paused: true,
  };
}
