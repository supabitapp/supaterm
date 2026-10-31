import type { EnvironmentId } from "@supaterm/contracts";

import { scopedThreadKey } from "../lib/scopedEntities";
import { appAtomRegistry } from "./atom-registry";
import { threadOutboxManager } from "./thread-outbox";
import { releaseUnusedQueuedVoiceRecordings } from "./thread-outbox-audio";
import type { QueuedThreadMessage } from "./thread-outbox-model";
import {
  clearComposerDraft,
  composerDraftsAtom,
  flushComposerDrafts,
  scheduleUnusedComposerAttachmentCleanup,
  waitForComposerDraftsLoaded,
} from "./use-composer-drafts";

async function cleanUpRemovedMessages(
  removedMessages: ReadonlyArray<QueuedThreadMessage>,
): Promise<void> {
  if (removedMessages.some((message) => message.voice !== undefined)) {
    void releaseUnusedQueuedVoiceRecordings().catch((error: unknown) => {
      console.warn("[thread-outbox] failed to delete removed voice recordings", error);
    });
  }
  const attachments = removedMessages.flatMap((message) => message.attachments);
  const removedCreations = removedMessages.filter((message) => message.creation !== undefined);
  if (removedCreations.length === 0) {
    scheduleUnusedComposerAttachmentCleanup(attachments);
    return;
  }

  try {
    await waitForComposerDraftsLoaded();
    const liveMessageIds = new Set(
      Object.values(appAtomRegistry.get(threadOutboxManager.queuedMessagesByThreadKeyAtom))
        .flat()
        .map((message) => message.messageId),
    );
    const drafts = appAtomRegistry.get(composerDraftsAtom);
    let clearedDraft = false;
    for (const message of removedCreations) {
      if (liveMessageIds.has(message.messageId)) {
        continue;
      }
      const draftKey = `pending-task:${message.messageId}`;
      const draft = drafts[draftKey];
      if (draft === undefined) {
        continue;
      }
      attachments.push(...draft.attachments);
      clearComposerDraft(draftKey, { deferAttachmentCleanup: true });
      clearedDraft = true;
    }
    if (clearedDraft) {
      await flushComposerDrafts();
    }
  } catch (error) {
    // The outbox removal is already durable. Keep the files and report the
    // secondary cleanup failure without changing the successful result.
    console.warn("[thread-outbox] failed to clean up removed pending task drafts", error);
    return;
  }

  scheduleUnusedComposerAttachmentCleanup(attachments);
}

/**
 * `expectedRevision` (from `threadOutboxRevision`) and `canRemove` make the
 * removal a compare-and-set: when an edit was accepted or an editor takes the
 * message, it stays queued, nothing is released, and this returns false.
 */
export async function removeThreadOutboxMessage(
  message: QueuedThreadMessage,
  expectedRevision?: number,
  canRemove?: () => boolean,
): Promise<boolean> {
  const removed = await threadOutboxManager.remove(message, expectedRevision, canRemove);
  if (removed === null) {
    return false;
  }
  // The removed payload, not the caller's snapshot: an accepted update may
  // have added files the snapshot never saw.
  await cleanUpRemovedMessages([removed]);
  return true;
}

/**
 * Deletes a pending task together with the follow-ups queued behind it. The
 * task goes first: until then it heads their queue, so none can be sent.
 */
export async function removePendingThreadCreation(
  creation: QueuedThreadMessage,
  canRemove: () => boolean,
): Promise<boolean> {
  const queue =
    appAtomRegistry.get(threadOutboxManager.queuedMessagesByThreadKeyAtom)[
      scopedThreadKey(creation.environmentId, creation.threadId)
    ] ?? [];
  if (!(await removeThreadOutboxMessage(creation, undefined, canRemove))) return false;
  for (const message of queue) {
    if (message.creation !== undefined) continue;
    // The drain drops leftovers once the shell is live; this keeps them from
    // lingering while offline.
    await removeThreadOutboxMessage(message).catch((error: unknown) => {
      console.warn("[thread-outbox] failed to remove a deleted task's follow-up", error);
    });
  }
  return true;
}

export async function clearThreadOutboxEnvironment(environmentId: EnvironmentId): Promise<void> {
  // clearEnvironment loads and merges persisted messages itself and reports
  // what it actually removed, so the release set cannot miss messages a
  // failed earlier hydration would have hidden.
  const removed = await threadOutboxManager.clearEnvironment(environmentId);
  await cleanUpRemovedMessages(removed);
}
