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

async function cleanUpRemovedMessages(removedMessages: ReadonlyArray<QueuedThreadMessage>) {
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
    console.warn("[thread-outbox] failed to clean up removed pending task drafts", error);
    return;
  }

  scheduleUnusedComposerAttachmentCleanup(attachments);
}

/** Returns false without releasing files if expectedRevision changed or canRemove rejects current ownership. */
export async function removeThreadOutboxMessage(
  message: QueuedThreadMessage,
  expectedRevision?: number,
  canRemove?: () => boolean,
) {
  const removed = await threadOutboxManager.remove(message, expectedRevision, canRemove);
  if (removed === null) {
    return false;
  }
  await cleanUpRemovedMessages([removed]);
  return true;
}

/**
 * Deletes a pending task together with the follow-ups queued behind it. The
 * task goes first: until then it heads their queue, so none can be sent.
 */
export function removePendingThreadCreation(
  creation: QueuedThreadMessage,
  canRemove: () => boolean,
): Promise<boolean>;
export async function removePendingThreadCreation(
  creation: QueuedThreadMessage,
  canRemove: () => boolean,
) {
  const queue =
    appAtomRegistry.get(threadOutboxManager.queuedMessagesByThreadKeyAtom)[
      scopedThreadKey(creation.environmentId, creation.threadId)
    ] ?? [];
  if (!(await removeThreadOutboxMessage(creation, undefined, canRemove)))
    return false satisfies boolean;
  for (const message of queue) {
    if (message.creation !== undefined) continue;
    await removeThreadOutboxMessage(message).catch((error: unknown) => {
      console.warn("[thread-outbox] failed to remove a deleted task's follow-up", error);
    });
  }
  return true satisfies boolean;
}

export async function clearThreadOutboxEnvironment(environmentId: EnvironmentId) {
  const removed = await threadOutboxManager.clearEnvironment(environmentId);
  await cleanUpRemovedMessages(removed);
}
