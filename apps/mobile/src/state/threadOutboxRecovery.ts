import { PROVIDER_SEND_TURN_MAX_ATTACHMENTS } from "@supaterm/contracts";
import { createDebugLogger } from "../lib/debugLog";
import { scopedThreadKey } from "../lib/scopedEntities";
import { appAtomRegistry } from "./atom-registry";
import {
  retainAcknowledgedThreadMessage,
  forgetAcknowledgedThreadMessage,
} from "./acknowledged-thread-messages";
import { restoredNewTaskDraftKey } from "./new-task-draft-key";
import { recordPendingThreadCreationOutcome } from "./pending-thread-creation";
import {
  confirmThreadOutboxMessageQueued,
  threadOutboxManager,
  threadOutboxRevision,
} from "./thread-outbox";
import { removeThreadOutboxMessage } from "./thread-outbox-removal";
import type { QueuedThreadMessage } from "./thread-outbox-model";
import { clearThreadComposerError, setThreadComposerError } from "./thread-composer-error";
import { editingQueuedMessageIdsAtom } from "./use-thread-outbox";
import {
  appendComposerDraftAttachments,
  flushComposerDrafts,
  type ComposerDraft,
  getComposerDraftSnapshot,
  mergeComposerDraftContent,
  replaceComposerDraftAttachments,
  undoComposerDraftMerge,
  updateComposerDraftSettings,
  waitForComposerDraftsLoaded,
} from "./use-composer-drafts";

const threadOutboxDebug = createDebugLogger("thread-outbox");

export async function completeQueuedMessageDelivery(
  queuedMessage: QueuedThreadMessage,
  deliveryRevision: number,
  sequence: number | undefined,
): Promise<"removed" | "edited" | "failed"> {
  clearThreadComposerError(
    scopedThreadKey(queuedMessage.environmentId, queuedMessage.threadId),
    queuedMessage.messageId,
  );
  try {
    // The editor may have taken the entry while startTurn was in flight; its
    // unsaved edits have not bumped the revision yet, so the CAS alone would
    // let removal win and the editor would lose them once it saves.
    if (appAtomRegistry.get(editingQueuedMessageIdsAtom)[queuedMessage.messageId]) {
      return "edited";
    }
    retainAcknowledgedThreadMessage(
      sequence === undefined ? queuedMessage : { ...queuedMessage, sequence },
    );
    const removed = await removeThreadOutboxMessage(
      queuedMessage,
      deliveryRevision,
      () => !appAtomRegistry.get(editingQueuedMessageIdsAtom)[queuedMessage.messageId],
    );
    if (!removed) {
      forgetAcknowledgedThreadMessage(queuedMessage);
      threadOutboxDebug.log("delivered message was edited before cleanup", {
        environmentId: queuedMessage.environmentId,
        threadId: queuedMessage.threadId,
        messageId: queuedMessage.messageId,
      });
      return "edited";
    }
    return "removed";
  } catch (error) {
    forgetAcknowledgedThreadMessage(queuedMessage);
    console.warn("[thread-outbox] failed to remove delivered queued message", {
      environmentId: queuedMessage.environmentId,
      threadId: queuedMessage.threadId,
      messageId: queuedMessage.messageId,
      error,
    });
    return "failed";
  }
}

export async function removeAcknowledgedQueuedMessage(
  queuedMessage: QueuedThreadMessage,
): Promise<"removed" | "retry"> {
  try {
    const removed = await removeThreadOutboxMessage(queuedMessage);
    return removed ? "removed" : "retry";
  } catch (error) {
    console.warn("[thread-outbox] failed to remove acknowledged queued message", {
      environmentId: queuedMessage.environmentId,
      threadId: queuedMessage.threadId,
      messageId: queuedMessage.messageId,
      error,
    });
    return "retry";
  }
}

export async function recoverEditedCreationAfterDelivery(
  queuedMessage: QueuedThreadMessage,
): Promise<"recovered" | "deferred" | "retry"> {
  const kept = Object.values(appAtomRegistry.get(threadOutboxManager.queuedMessagesByThreadKeyAtom))
    .flat()
    .find((candidate) => candidate.messageId === queuedMessage.messageId);
  if (!kept) {
    return "recovered";
  }
  const keptRevision = threadOutboxRevision(kept.messageId);
  if (appAtomRegistry.get(editingQueuedMessageIdsAtom)[kept.messageId]) {
    return "deferred";
  }
  const draftKey = scopedThreadKey(kept.environmentId, kept.threadId);
  try {
    // Merge before removing: the draft's reference keeps the removal sweep
    // from deleting the attachment files. allowOverflow mirrors the
    // send-failure restore; the send path refuses over-cap drafts, so the
    // state stays recoverable.
    await mergeComposerDraftContent(draftKey, {
      text: kept.text,
      context: kept.context,
      attachments: [],
    });
    if (appAtomRegistry.get(editingQueuedMessageIdsAtom)[kept.messageId]) {
      return "deferred";
    }
    if (threadOutboxRevision(kept.messageId) !== keptRevision) {
      return "retry";
    }
    const existingAttachmentIds = new Set(
      getComposerDraftSnapshot(draftKey).attachments.map((attachment) => attachment.id),
    );
    appendComposerDraftAttachments(
      draftKey,
      kept.attachments.filter((attachment) => !existingAttachmentIds.has(attachment.id)),
      { allowOverflow: true },
    );
    updateComposerDraftSettings(draftKey, {
      ...(kept.modelSelection !== undefined ? { modelSelection: kept.modelSelection } : {}),
      ...(kept.runtimeMode !== undefined ? { runtimeMode: kept.runtimeMode } : {}),
    });
    // The append only schedules a debounced write; the queue entry is the
    // only durable copy until the draft lands, so flush before removing.
    await flushComposerDrafts();
  } catch (error) {
    console.warn("[thread-outbox] could not hand an edited pending task to the composer", error);
    return "retry";
  }
  if (appAtomRegistry.get(editingQueuedMessageIdsAtom)[kept.messageId]) {
    return "deferred";
  }
  try {
    return (await removeThreadOutboxMessage(
      kept,
      keptRevision,
      () => !appAtomRegistry.get(editingQueuedMessageIdsAtom)[kept.messageId],
    ))
      ? "recovered"
      : "retry";
  } catch (error) {
    console.warn("[thread-outbox] could not remove recovered pending task", error);
    return "retry";
  }
}

export async function restoreRejectedQueuedMessage(
  queuedMessage: QueuedThreadMessage,
  message: string,
): Promise<"restored" | "deferred" | "blocked" | "retry"> {
  const draftKey = recoveryDraftKey(queuedMessage);
  const threadKey = scopedThreadKey(queuedMessage.environmentId, queuedMessage.threadId);
  let rollback: { readonly snapshot: ComposerDraft; readonly merged: ComposerDraft } | null = null;
  try {
    if (
      appAtomRegistry.get(editingQueuedMessageIdsAtom)[queuedMessage.messageId] ||
      !(await confirmThreadOutboxMessageQueued(queuedMessage)) ||
      appAtomRegistry.get(editingQueuedMessageIdsAtom)[queuedMessage.messageId]
    ) {
      return "deferred";
    }
    const revision = threadOutboxRevision(queuedMessage.messageId);

    await waitForComposerDraftsLoaded();
    if (appAtomRegistry.get(editingQueuedMessageIdsAtom)[queuedMessage.messageId]) {
      return "deferred";
    }
    const originalDraft = getComposerDraftSnapshot(draftKey);
    const existingAttachmentIds = new Set(
      originalDraft.attachments.map((attachment) => attachment.id),
    );
    const addedAttachmentCount = queuedMessage.attachments.filter(
      (attachment) => !existingAttachmentIds.has(attachment.id),
    ).length;
    if (existingAttachmentIds.size + addedAttachmentCount > PROVIDER_SEND_TURN_MAX_ATTACHMENTS) {
      setThreadComposerError(
        threadKey,
        `Remove attachments from the draft before restoring this message. Messages can contain at most ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS} attachments.`,
        queuedMessage.messageId,
      );
      return "blocked";
    }

    const withdrawError = () => clearThreadComposerError(threadKey, queuedMessage.messageId);
    if (!queuedMessage.creation) {
      setThreadComposerError(threadKey, message, queuedMessage.messageId);
    }
    let mergedDraft: ComposerDraft;
    try {
      stampRecoveryDraftProject(queuedMessage, draftKey);
      await mergeComposerDraftContent(draftKey, {
        text: queuedMessage.text,
        context: queuedMessage.context,
        attachments: queuedMessage.attachments,
      });
    } finally {
      mergedDraft = getComposerDraftSnapshot(draftKey);
      rollback = { snapshot: originalDraft, merged: mergedDraft };
    }
    if (appAtomRegistry.get(editingQueuedMessageIdsAtom)[queuedMessage.messageId]) {
      withdrawError();
      await undoComposerDraftMerge(draftKey, originalDraft, mergedDraft);
      return "deferred";
    }
    updateComposerDraftSettings(draftKey, {
      ...(queuedMessage.modelSelection ? { modelSelection: queuedMessage.modelSelection } : {}),
      ...(queuedMessage.runtimeMode ? { runtimeMode: queuedMessage.runtimeMode } : {}),
      ...(queuedMessage.creation
        ? {
            workspaceSelection: {
              mode: queuedMessage.creation.workspaceMode,
              branch: queuedMessage.creation.branch,
              worktreePath: queuedMessage.creation.worktreePath,
              pullRequestReference: queuedMessage.creation.pullRequestReference,
              ...(queuedMessage.creation.startFromOrigin !== undefined
                ? { startFromOrigin: queuedMessage.creation.startFromOrigin }
                : {}),
            },
          }
        : {}),
    });
    // Follow-ups queued behind a rejected task have no thread to reach. They
    // join its draft in this same merge, so a rollback takes them out with the
    // task and a retry cannot add them twice.
    const followUps = queuedMessage.creation ? queuedFollowUps(threadKey) : [];
    const editingQueuedMessageIds = appAtomRegistry.get(editingQueuedMessageIdsAtom);
    if (followUps.some((followUp) => editingQueuedMessageIds[followUp.messageId])) {
      withdrawError();
      await undoComposerDraftMerge(draftKey, originalDraft, getComposerDraftSnapshot(draftKey));
      return "deferred";
    }
    for (const followUp of followUps) {
      try {
        await mergeFollowUpIntoDraft(draftKey, followUp);
      } finally {
        rollback = { snapshot: originalDraft, merged: getComposerDraftSnapshot(draftKey) };
      }
    }
    const restoredDraft = getComposerDraftSnapshot(draftKey);
    rollback = { snapshot: originalDraft, merged: restoredDraft };
    await flushComposerDrafts();
    if (
      appAtomRegistry.get(editingQueuedMessageIdsAtom)[queuedMessage.messageId] ||
      !(await confirmThreadOutboxMessageQueued(queuedMessage)) ||
      appAtomRegistry.get(editingQueuedMessageIdsAtom)[queuedMessage.messageId]
    ) {
      withdrawError();
      await undoComposerDraftMerge(draftKey, originalDraft, restoredDraft);
      return "deferred";
    }
    if (
      !(await removeThreadOutboxMessage(
        queuedMessage,
        revision,
        () => !appAtomRegistry.get(editingQueuedMessageIdsAtom)[queuedMessage.messageId],
      ))
    ) {
      withdrawError();
      await undoComposerDraftMerge(draftKey, originalDraft, restoredDraft);
      return "deferred";
    }
    // The queued message is gone; from here the draft owns the content and
    // must never be rolled back.
    rollback = null;
    if (queuedMessage.creation) {
      withdrawError();
      recordPendingThreadCreationOutcome({
        kind: "failed",
        message: queuedMessage,
        reason: message,
      });
      // The outcome stops new sends into this thread, so this read also
      // catches a follow-up queued while the restore ran.
      const folded = new Set(followUps.map((followUp) => followUp.messageId));
      for (const followUp of queuedFollowUps(threadKey)) {
        try {
          if (!folded.has(followUp.messageId)) {
            await mergeFollowUpIntoDraft(draftKey, followUp);
            await flushComposerDrafts();
          }
          // The draft holds its content now. One left behind is dropped with
          // the missing thread.
          await removeThreadOutboxMessage(followUp);
        } catch (error) {
          console.warn("[thread-outbox] failed to fold a follow-up of a rejected task", error);
        }
      }
    }
    return "restored";
  } catch (error) {
    if (rollback !== null) {
      await undoComposerDraftMerge(draftKey, rollback.snapshot, rollback.merged).catch(
        (undoError) => {
          console.warn("[thread-outbox] failed to persist a recovery rollback", undoError);
        },
      );
    }
    console.warn("[thread-outbox] failed to restore an undeliverable message", error);
    setThreadComposerError(
      threadKey,
      error instanceof Error ? error.message : "The unsent message could not be restored.",
      queuedMessage.messageId,
    );
    return "retry";
  }
}

function queuedFollowUps(threadKey: string): ReadonlyArray<QueuedThreadMessage> {
  return (
    appAtomRegistry.get(threadOutboxManager.queuedMessagesByThreadKeyAtom)[threadKey] ?? []
  ).filter((message) => !message.creation);
}

async function mergeFollowUpIntoDraft(draftKey: string, followUp: QueuedThreadMessage) {
  await mergeComposerDraftContent(draftKey, {
    text: followUp.text,
    context: followUp.context,
    attachments: [],
  });
  appendComposerDraftAttachments(draftKey, followUp.attachments, { allowOverflow: true });
}

/**
 * The key derives from the message id so a retry after a mid-recovery failure lands on the same
 * draft instead of minting another.
 */
export function recoveryDraftKey(queuedMessage: QueuedThreadMessage): string {
  return queuedMessage.creation
    ? restoredNewTaskDraftKey(queuedMessage.messageId)
    : scopedThreadKey(queuedMessage.environmentId, queuedMessage.threadId);
}

function stampRecoveryDraftProject(queuedMessage: QueuedThreadMessage, draftKey: string): void {
  if (!queuedMessage.creation) {
    return;
  }
  updateComposerDraftSettings(draftKey, {
    project: {
      environmentId: queuedMessage.environmentId,
      projectId: queuedMessage.creation.projectId,
      createdAt: queuedMessage.createdAt,
    },
  });
}

export async function preserveUploadedAttachmentsForEditor(
  originalMessage: QueuedThreadMessage,
  uploadedMessage: QueuedThreadMessage,
): Promise<void> {
  if (!originalMessage.creation) {
    return;
  }

  const draftKey = `pending-task:${originalMessage.messageId}`;
  const draft = getComposerDraftSnapshot(draftKey);
  const uploadedById = new Map(
    uploadedMessage.attachments.map((attachment) => [attachment.id, attachment] as const),
  );
  let changed = false;
  const nextAttachments = draft.attachments.map((attachment) => {
    const uploaded = uploadedById.get(attachment.id);
    if (
      !uploaded?.uploadedAttachmentId ||
      uploaded.uploadEnvironmentId !== originalMessage.environmentId ||
      (attachment.uploadedAttachmentId === uploaded.uploadedAttachmentId &&
        attachment.uploadEnvironmentId === uploaded.uploadEnvironmentId)
    ) {
      return attachment;
    }
    changed = true;
    return {
      ...attachment,
      uploadedAttachmentId: uploaded.uploadedAttachmentId,
      uploadEnvironmentId: uploaded.uploadEnvironmentId,
    };
  });
  if (changed) {
    replaceComposerDraftAttachments(draftKey, nextAttachments);
    await flushComposerDrafts();
  }
}
