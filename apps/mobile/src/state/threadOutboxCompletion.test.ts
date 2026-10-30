import "./threadOutbox.test-support";
import { appAtomRegistry } from "./atom-registry";
import { setThreadComposerError } from "./thread-composer-error";
import { threadComposerErrorsAtom } from "./thread-composer-error";
import * as composerDrafts from "./use-composer-drafts";
import { editingQueuedMessageIdsAtom } from "./use-thread-outbox";
import { acknowledgedThreadMessagesAtom } from "./acknowledged-thread-messages";
import { describe, expect, it, vi } from "vite-plus/test";
import { harness, queuedMessage, remainingMessages } from "./threadOutbox.test-support";

import {
  completeQueuedMessageDelivery,
  recoverEditedCreationAfterDelivery,
  removeAcknowledgedExistingThreadMessage,
} from "./threadOutboxRecovery";

describe("thread outbox drain delivery cleanup", () => {
  it("retries only cleanup after an acknowledged send removal fails", async () => {
    const message = queuedMessage({ messageId: "message-acknowledged", text: "delivered" });
    const acknowledged = new Set([message.messageId]);
    harness.removeOutboxMessage.mockRejectedValueOnce(new Error("storage unavailable"));
    await harness.manager.enqueue(message);

    await expect(removeAcknowledgedExistingThreadMessage(message, acknowledged)).resolves.toBe(
      false,
    );
    expect(remainingMessages()).toEqual([message]);
    expect(acknowledged).toEqual(new Set([message.messageId]));

    await expect(removeAcknowledgedExistingThreadMessage(message, acknowledged)).resolves.toBe(
      true,
    );
    expect(remainingMessages()).toEqual([]);
    expect(acknowledged).toEqual(new Set());
  });

  it("keeps an edited message and its files when delivery cleanup loses the revision race", async () => {
    const message = queuedMessage({
      messageId: "message-edited",
      text: "original",
      fileUri: "file:///documents/supaterm-composer-attachments/report.pdf",
    });
    await harness.manager.enqueue(message);
    const deliveryRevision = harness.manager.revisionOf(message.messageId);
    const edited = { ...message, text: "edited while the turn delivered" };
    await harness.manager.update(edited);

    await expect(completeQueuedMessageDelivery(message, deliveryRevision, undefined)).resolves.toBe(
      "edited",
    );

    expect(remainingMessages()).toEqual([edited]);
    expect(harness.removePersistedFile).not.toHaveBeenCalled();
  });

  it("removes the delivered message when no edit was accepted", async () => {
    const message = queuedMessage({ messageId: "message-clean", text: "hello" });
    await harness.manager.enqueue(message);
    const deliveryRevision = harness.manager.revisionOf(message.messageId);

    await expect(completeQueuedMessageDelivery(message, deliveryRevision, undefined)).resolves.toBe(
      "removed",
    );

    expect(remainingMessages()).toEqual([]);
    expect(appAtomRegistry.get(acknowledgedThreadMessagesAtom)).toEqual([message]);
  });

  it("clears an error about the delivered message but keeps one about another message", async () => {
    const threadKey = "environment-1:thread-1";
    const retried = queuedMessage({ messageId: "message-retried", text: "retried" });
    await harness.manager.enqueue(retried);
    setThreadComposerError(threadKey, "could not be restored", retried.messageId);

    await completeQueuedMessageDelivery(
      retried,
      harness.manager.revisionOf(retried.messageId),
      undefined,
    );
    expect(appAtomRegistry.get(threadComposerErrorsAtom)[threadKey]).toBeUndefined();

    const other = queuedMessage({ messageId: "message-other", text: "other" });
    await harness.manager.enqueue(other);
    setThreadComposerError(threadKey, "rejected", "message-rejected");

    await completeQueuedMessageDelivery(
      other,
      harness.manager.revisionOf(other.messageId),
      undefined,
    );
    expect(appAtomRegistry.get(threadComposerErrorsAtom)[threadKey]?.message).toBe("rejected");
  });

  it("keeps a delivered message when its editor opens during storage removal", async () => {
    const message = queuedMessage({
      messageId: "message-editor-removal-race",
      text: "keep editor changes",
      fileUri: "file:///documents/supaterm-composer-attachments/editor-race.pdf",
    });
    const removeStarted = Promise.withResolvers<void>();
    const removeBarrier = Promise.withResolvers<void>();
    harness.removeOutboxMessage.mockImplementationOnce(async () => {
      removeStarted.resolve();
      await removeBarrier.promise;
    });
    await harness.manager.enqueue(message);
    const deliveryRevision = harness.manager.revisionOf(message.messageId);

    const cleanup = completeQueuedMessageDelivery(message, deliveryRevision, undefined);
    await removeStarted.promise;
    appAtomRegistry.set(editingQueuedMessageIdsAtom, { [message.messageId]: "editing" });
    removeBarrier.resolve();

    await expect(cleanup).resolves.toBe("edited");
    expect(remainingMessages()).toEqual([message]);
    expect(harness.removePersistedFile).not.toHaveBeenCalled();
  });
});

describe("thread outbox delivered creation recovery", () => {
  it("keeps an edit accepted while the older payload is persisted to the draft", async () => {
    const message = queuedMessage({
      messageId: "message-recovery-race",
      text: "original queued text",
      fileUri: "file:///documents/supaterm-composer-attachments/report.pdf",
    });
    const originalMergeComposerDraftContent = composerDrafts.mergeComposerDraftContent;
    const mergeCompleted = Promise.withResolvers<void>();
    const releaseRecovery = Promise.withResolvers<void>();
    const mergeSpy = vi
      .spyOn(composerDrafts, "mergeComposerDraftContent")
      .mockImplementation(async (draftKey, content) => {
        const result = await originalMergeComposerDraftContent(draftKey, content);
        mergeCompleted.resolve();
        await releaseRecovery.promise;
        return result;
      });

    try {
      await harness.manager.enqueue(message);
      const recovery = recoverEditedCreationAfterDelivery(message);
      await mergeCompleted.promise;

      const newer = { ...message, text: "edited while recovery persisted the draft" };
      await harness.manager.update(newer);

      releaseRecovery.resolve();
      await expect(recovery).resolves.toBe(false);

      expect(remainingMessages()).toEqual([newer]);
      expect(
        composerDrafts.getComposerDraftSnapshot(`${message.environmentId}:${message.threadId}`),
      ).toMatchObject({ text: message.text, attachments: [] });
      expect(harness.removePersistedFile).not.toHaveBeenCalled();
    } finally {
      releaseRecovery.resolve();
      mergeSpy.mockRestore();
    }
  });

  it("leaves recovery to an editor that opens while the draft persists", async () => {
    const message = queuedMessage({
      messageId: "message-recovery-editor",
      text: "recover this text",
      fileUri: "file:///documents/supaterm-composer-attachments/editor.pdf",
    });
    const originalMergeComposerDraftContent = composerDrafts.mergeComposerDraftContent;
    const mergeCompleted = Promise.withResolvers<void>();
    const releaseRecovery = Promise.withResolvers<void>();
    const mergeSpy = vi
      .spyOn(composerDrafts, "mergeComposerDraftContent")
      .mockImplementation(async (draftKey, content) => {
        const result = await originalMergeComposerDraftContent(draftKey, content);
        mergeCompleted.resolve();
        await releaseRecovery.promise;
        return result;
      });

    try {
      await harness.manager.enqueue(message);
      const recovery = recoverEditedCreationAfterDelivery(message);
      await mergeCompleted.promise;
      appAtomRegistry.set(editingQueuedMessageIdsAtom, { [message.messageId]: "editing" });

      releaseRecovery.resolve();
      await expect(recovery).resolves.toBe(true);

      expect(remainingMessages()).toEqual([message]);
      expect(
        composerDrafts.getComposerDraftSnapshot(`${message.environmentId}:${message.threadId}`),
      ).toMatchObject({ text: message.text, attachments: [] });
      expect(harness.removePersistedFile).not.toHaveBeenCalled();
    } finally {
      releaseRecovery.resolve();
      mergeSpy.mockRestore();
    }
  });

  it("retries a failed removal without duplicating recovered draft content", async () => {
    const message = queuedMessage({
      messageId: "message-recovery-removal",
      text: "recover once",
      fileUri: "file:///documents/supaterm-composer-attachments/retry.pdf",
    });
    const draftKey = `${message.environmentId}:${message.threadId}`;
    const removeSpy = vi
      .spyOn(harness.manager, "remove")
      .mockRejectedValueOnce(new Error("storage unavailable"));

    try {
      await harness.manager.enqueue(message);

      await expect(recoverEditedCreationAfterDelivery(message)).resolves.toBe(false);
      expect(remainingMessages()).toEqual([message]);

      await expect(recoverEditedCreationAfterDelivery(message)).resolves.toBe(true);

      const draft = composerDrafts.getComposerDraftSnapshot(draftKey);
      expect(draft.text).toBe(message.text);
      expect(draft.attachments).toEqual(message.attachments);
      expect(remainingMessages()).toEqual([]);
      expect(harness.removePersistedFile).not.toHaveBeenCalled();
    } finally {
      removeSpy.mockRestore();
    }
  });

  it("keeps the queue entry when the recovered draft cannot persist", async () => {
    const message = queuedMessage({
      messageId: "message-recovery-persistence",
      text: "recover after persistence returns",
    });
    await harness.manager.enqueue(message);
    harness.draftFile.setWriteError(new Error("disk full"));

    await expect(recoverEditedCreationAfterDelivery(message)).resolves.toBe(false);

    expect(remainingMessages()).toEqual([message]);
  });
});
