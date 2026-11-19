import { PROVIDER_SEND_TURN_MAX_ATTACHMENTS } from "@supaterm/contracts";
import { scopedThreadKey } from "../lib/scopedEntities";
import { appAtomRegistry } from "./atom-registry";
import {
  confirmThreadOutboxMessageQueued,
  threadOutboxRevision,
  type QueuedThreadMessage,
} from "./thread-outbox";
import { removeThreadOutboxMessage } from "./thread-outbox-removal";
import {
  applyComposerDraftContent,
  captureComposerDraftMerge,
  type ComposerDraftMergeReceipt,
  flushComposerDrafts,
  getComposerDraftSnapshot,
  undoComposerDraftMerge,
  updateComposerDraftSettings,
  waitForComposerDraftsLoaded,
} from "./use-composer-drafts";
import {
  dispatchingQueuedMessageIdsAtom,
  editingQueuedMessageIdsAtom,
  holdEditingQueuedMessage,
  releaseEditingQueuedMessage,
} from "./use-thread-outbox";

/** Take delivery ownership before any await; the durable draft then takes ownership of the files. */
export async function editPendingThreadMessage(message: QueuedThreadMessage) {
  if (
    message.creation ||
    message.voice ||
    appAtomRegistry.get(dispatchingQueuedMessageIdsAtom)[message.messageId] ||
    appAtomRegistry.get(editingQueuedMessageIdsAtom)[message.messageId]
  ) {
    return false;
  }
  holdEditingQueuedMessage(message.messageId);
  const draftKey = scopedThreadKey(message.environmentId, message.threadId);
  let rollback: ComposerDraftMergeReceipt | null = null;
  try {
    if (!(await confirmThreadOutboxMessageQueued(message))) return false;
    const revision = threadOutboxRevision(message.messageId);
    await waitForComposerDraftsLoaded();
    const attachmentIds = new Set(
      getComposerDraftSnapshot(draftKey).attachments.map((attachment) => attachment.id),
    );
    for (const attachment of message.attachments) attachmentIds.add(attachment.id);
    if (attachmentIds.size > PROVIDER_SEND_TURN_MAX_ATTACHMENTS) {
      throw new Error("Remove attachments from the composer before editing this message.");
    }
    rollback = captureComposerDraftMerge(draftKey, () => {
      applyComposerDraftContent(draftKey, message);
      updateComposerDraftSettings(draftKey, {
        ...(message.modelSelection ? { modelSelection: message.modelSelection } : {}),
        ...(message.runtimeMode ? { runtimeMode: message.runtimeMode } : {}),
      });
    });
    await flushComposerDrafts();
    if (!(await removeThreadOutboxMessage(message, revision))) return false;
    rollback = null;
    return true;
  } finally {
    try {
      if (rollback) await undoComposerDraftMerge(draftKey, rollback.snapshot, rollback.merged);
    } finally {
      releaseEditingQueuedMessage(message.messageId);
    }
  }
}
