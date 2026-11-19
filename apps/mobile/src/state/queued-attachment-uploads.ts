import type { DraftComposerAttachment } from "../lib/composerImages";
import { appAtomRegistry } from "./atom-registry";
import { threadOutboxManager, type QueuedThreadMessage } from "./thread-outbox";
import { editingQueuedMessageIdsAtom } from "./use-thread-outbox";

function withUploadedAttachments(
  message: QueuedThreadMessage,
  uploaded: ReadonlyArray<DraftComposerAttachment>,
): QueuedThreadMessage | null {
  const uploadedById = new Map(uploaded.map((attachment) => [attachment.id, attachment] as const));
  let changed = false;
  const attachments = message.attachments.map((attachment) => {
    const upload = uploadedById.get(attachment.id);
    if (
      upload?.uploadedAttachmentId === undefined ||
      (upload.uploadedAttachmentId === attachment.uploadedAttachmentId &&
        upload.uploadEnvironmentId === attachment.uploadEnvironmentId)
    ) {
      return attachment;
    }
    changed = true;
    return {
      ...attachment,
      uploadedAttachmentId: upload.uploadedAttachmentId,
      uploadEnvironmentId: upload.uploadEnvironmentId,
    };
  });
  return changed ? { ...message, attachments } : null;
}

/**
 * Records uploaded ids on a queued message without moving the revision its edits are saved
 * against. An open editor owns the message and records them in its draft instead. Resolves to
 * the queued message once it carries every id, or null.
 */
export async function recordQueuedAttachmentUploads(
  messageId: QueuedThreadMessage["messageId"],
  uploaded: ReadonlyArray<DraftComposerAttachment>,
): Promise<QueuedThreadMessage | null> {
  await threadOutboxManager.amend(messageId, (current) =>
    appAtomRegistry.get(editingQueuedMessageIdsAtom)[messageId]
      ? null
      : withUploadedAttachments(current, uploaded),
  );
  const committed = threadOutboxManager
    .getSnapshot()
    .find((candidate) => candidate.messageId === messageId);
  return committed !== undefined && withUploadedAttachments(committed, uploaded) === null
    ? committed
    : null;
}
