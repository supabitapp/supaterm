import "./threadOutbox.test-support";
import { appAtomRegistry } from "./atom-registry";
import { editingQueuedMessageIdsAtom } from "./use-thread-outbox";
import type { PreparedTurnAttachments } from "../lib/attachmentUpload";
import { describe, expect, it } from "vite-plus/test";
import {
  harness,
  queuedMessage,
  withReusedFileUpload,
  remainingMessages,
} from "./threadOutbox.test-support";

import { prepareQueuedMessageAttachments } from "./threadOutboxAttachments";

describe("thread outbox attachment preparation", () => {
  it("keeps a denied message queued without starting its attachment upload", async () => {
    const message = queuedMessage({
      messageId: "denied-queued-message",
      text: "Keep this queued",
      fileUri: "file:///documents/keep.pdf",
    });
    await harness.manager.enqueue(message);
    harness.prepareTurnAttachments.mockResolvedValueOnce({
      status: "ready",
      attachments: [],
      draftAttachments: message.attachments,
      pendingAttachmentIds: [],
    });
    harness.canOperate = false;
    await expect(prepareQueuedMessageAttachments(message)).resolves.toEqual({
      status: "abandoned",
    });
    expect(harness.prepareTurnAttachments).not.toHaveBeenCalled();
    expect(remainingMessages()).toEqual([message]);
  });

  it("abandons reused uploads when an editor saves changed text during verification", async () => {
    const message = withReusedFileUpload(
      queuedMessage({
        messageId: "message-reused-upload-race",
        text: "original text",
        fileUri: "file:///documents/supaterm-composer-attachments/reused.pdf",
      }),
      "pending-reused-upload",
    );
    const preparationStarted = Promise.withResolvers<void>();
    const preparationBarrier = Promise.withResolvers<PreparedTurnAttachments>();
    harness.prepareTurnAttachments.mockImplementationOnce(async () => {
      preparationStarted.resolve();
      return preparationBarrier.promise;
    });
    await harness.manager.enqueue(message);
    appAtomRegistry.set(editingQueuedMessageIdsAtom, { [message.messageId]: "editing" });

    const preparation = prepareQueuedMessageAttachments(message);
    await preparationStarted.promise;
    const edited = { ...message, text: "saved editor text" };
    await harness.manager.update(edited);
    appAtomRegistry.set(editingQueuedMessageIdsAtom, {});
    preparationBarrier.resolve({
      status: "ready",
      attachments: [],
      draftAttachments: message.attachments,
      pendingAttachmentIds: ["pending-reused-upload"],
    });

    await expect(preparation).resolves.toEqual({ status: "abandoned" });
    expect(remainingMessages()).toEqual([edited]);
  });

  it("keeps an unchanged queued payload ready after attachment reuse", async () => {
    const message = withReusedFileUpload(
      queuedMessage({
        messageId: "message-reused-upload-current",
        text: "unchanged text",
        fileUri: "file:///documents/supaterm-composer-attachments/current.pdf",
      }),
      "pending-reused-upload",
    );
    harness.prepareTurnAttachments.mockResolvedValueOnce({
      status: "ready",
      attachments: [],
      draftAttachments: message.attachments,
      pendingAttachmentIds: ["pending-reused-upload"],
    });
    await harness.manager.enqueue(message);
    const revision = harness.manager.revisionOf(message.messageId);
    appAtomRegistry.set(editingQueuedMessageIdsAtom, { [message.messageId]: "editing" });

    await expect(prepareQueuedMessageAttachments(message)).resolves.toMatchObject({
      status: "ready",
      persistedMessage: message,
      deliveryRevision: revision,
    });
  });

  it("uses the known next revision after persisting uploaded references", async () => {
    const message = queuedMessage({
      messageId: "message-new-upload-revision",
      text: "upload this file",
      fileUri: "file:///documents/supaterm-composer-attachments/new.pdf",
    });
    const uploadedAttachments = message.attachments.map((attachment) =>
      attachment.type === "file"
        ? {
            ...attachment,
            uploadedAttachmentId: "pending-new-upload",
            uploadEnvironmentId: message.environmentId,
          }
        : attachment,
    );
    harness.prepareTurnAttachments.mockImplementationOnce(async (input) => {
      expect(await input.persistUploadedReferences?.(uploadedAttachments)).toBe("persisted");
      return {
        status: "ready",
        attachments: [],
        draftAttachments: uploadedAttachments,
        pendingAttachmentIds: ["pending-new-upload"],
      };
    });
    await harness.manager.enqueue(message);
    const revision = harness.manager.revisionOf(message.messageId);

    const result = await prepareQueuedMessageAttachments(message);

    expect(result).toMatchObject({
      status: "ready",
      persistedMessage: { attachments: uploadedAttachments },
      deliveryRevision: revision + 1,
    });
    expect(harness.manager.revisionOf(message.messageId)).toBe(revision + 1);
  });

  it("does not prepare a payload that was already replaced", async () => {
    const message = queuedMessage({ messageId: "message-stale-before-upload", text: "old" });
    await harness.manager.enqueue(message);
    const edited = { ...message, text: "new" };
    await harness.manager.update(edited);

    await expect(prepareQueuedMessageAttachments(message)).resolves.toEqual({
      status: "abandoned",
    });
    expect(harness.prepareTurnAttachments).not.toHaveBeenCalled();
    expect(remainingMessages()).toEqual([edited]);
  });
});
