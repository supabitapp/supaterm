import type { EnvironmentId, ServerConfig } from "@supaterm/contracts";
import { clampFileAttachmentUploadBytes } from "@supaterm/client-runtime/state/attachments";
import type { AttachmentUploadStatus } from "@supaterm/client-runtime/state/attachment-uploads";

import type { DraftComposerAttachment } from "./composerImages";

export interface ComposerAttachmentUploadRequest {
  readonly environmentId: EnvironmentId;
  readonly attachment: DraftComposerAttachment;
}

export type ComposerAttachmentUploadState = AttachmentUploadStatus;

export function composerAttachmentUploadKey(
  environmentId: EnvironmentId,
  attachmentId: string,
): string {
  return `${environmentId}:${attachmentId}`;
}

/**
 * Which environment a composer draft belongs to. Environment and thread ids may both contain
 * colons, so a thread draft key resolves to the longest known environment it starts with;
 * pending-task editor drafts borrow it from the queued message; new-task drafts carry it in
 * their project stamp.
 */
export function composerDraftEnvironmentId(
  draftKey: string,
  environmentIds: Iterable<EnvironmentId>,
  queuedMessages: ReadonlyArray<{
    readonly messageId: string;
    readonly environmentId: EnvironmentId;
  }>,
  draft?: { readonly project?: { readonly environmentId: EnvironmentId } },
): EnvironmentId | null {
  if (draftKey.startsWith("pending-task:")) {
    return (
      queuedMessages.find((message) => `pending-task:${message.messageId}` === draftKey)
        ?.environmentId ?? null
    );
  }
  if (draftKey.startsWith("new-task:")) {
    return draft?.project?.environmentId ?? null;
  }
  let match: EnvironmentId | null = null;
  for (const environmentId of environmentIds) {
    if (
      draftKey.startsWith(`${environmentId}:`) &&
      (match === null || environmentId.length > match.length)
    ) {
      match = environmentId;
    }
  }
  return match;
}

type UploadServerConfig = {
  readonly environment: {
    readonly capabilities: Pick<ServerConfig["environment"]["capabilities"], "fileAttachments">;
  };
};

export function canUploadComposerAttachment(
  attachment: DraftComposerAttachment,
  config: UploadServerConfig | null | undefined,
): boolean {
  if (config == null) return false;
  const { fileAttachments } = config.environment.capabilities;
  return (
    attachment.type === "image" ||
    (fileAttachments !== undefined &&
      attachment.sizeBytes <= clampFileAttachmentUploadBytes(fileAttachments.maxUploadBytes))
  );
}

export function composerAttachmentUploadBlockReason(input: {
  readonly environmentId: EnvironmentId;
  readonly attachments: ReadonlyArray<DraftComposerAttachment>;
  readonly connected: boolean;
  readonly serverConfig: UploadServerConfig | null;
  readonly states: Readonly<Record<string, ComposerAttachmentUploadState>>;
}): string | null {
  if (!input.connected) return null;
  for (const attachment of input.attachments) {
    if (!canUploadComposerAttachment(attachment, input.serverConfig)) continue;
    const state = input.states[composerAttachmentUploadKey(input.environmentId, attachment.id)];
    if (state?.status === "failed") return "Retry or remove the failed attachment";
  }
  return null;
}

export function composerAttachmentsStillUploading(input: {
  readonly environmentId: EnvironmentId;
  readonly attachments: ReadonlyArray<DraftComposerAttachment>;
  readonly serverConfig: UploadServerConfig | null;
  readonly states: Readonly<Record<string, ComposerAttachmentUploadState>>;
}): boolean {
  return input.attachments.some((attachment) => {
    if (!canUploadComposerAttachment(attachment, input.serverConfig)) return false;
    const state = input.states[composerAttachmentUploadKey(input.environmentId, attachment.id)];
    return state?.status !== "ready" && state?.status !== "failed";
  });
}
