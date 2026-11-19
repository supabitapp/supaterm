import type { QueuedThreadMessage } from "./thread-outbox-model";
import { scopedThreadKey } from "../lib/scopedEntities";
import { restoredNewTaskDraftKey } from "./new-task-draft-key";
import {
  appendComposerDraftAttachments,
  clearComposerDraftContent,
  flushComposerDrafts,
  getComposerDraftSnapshot,
  mergeComposerDraftContent,
} from "./use-composer-drafts";

export async function recoverFailedThreadDraft(message: QueuedThreadMessage) {
  const sourceKey = scopedThreadKey(message.environmentId, message.threadId);
  const targetKey = restoredNewTaskDraftKey(message.messageId);
  const source = getComposerDraftSnapshot(sourceKey);
  if (source.text.length === 0 && source.attachments.length === 0) return;

  await mergeComposerDraftContent(targetKey, {
    text: source.text,
    context: source.context,
    attachments: [],
  });
  const existingIds = new Set(
    getComposerDraftSnapshot(targetKey).attachments.map((attachment) => attachment.id),
  );
  appendComposerDraftAttachments(
    targetKey,
    source.attachments.filter((attachment) => !existingIds.has(attachment.id)),
    { restore: true },
  );
  await flushComposerDrafts();
  clearComposerDraftContent(sourceKey);
}
