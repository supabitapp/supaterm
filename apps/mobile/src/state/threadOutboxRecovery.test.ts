import "./threadOutbox.test-support";
import { ComposerContextId } from "@supaterm/contracts";
import { ProjectId } from "@supaterm/contracts";
import { ProviderInstanceId } from "@supaterm/contracts";
import { appAtomRegistry } from "./atom-registry";
import { clearPendingThreadCreationOutcome } from "./pending-thread-creation";
import { pendingThreadCreationOutcomesAtom } from "./pending-thread-creation";
import { clearThreadComposerError } from "./thread-composer-error";
import { threadComposerErrorsAtom } from "./thread-composer-error";
import * as composerDrafts from "./use-composer-drafts";
import { recoverFailedThreadDraft } from "./recover-failed-thread-draft";
import { editingQueuedMessageIdsAtom } from "./use-thread-outbox";
import type { QueuedThreadMessage } from "./thread-outbox-model";
import { describe, expect, it, vi } from "vite-plus/test";
import { harness, queuedMessage, remainingMessages } from "./threadOutbox.test-support";

import { restoreRejectedQueuedMessage } from "./threadOutboxRecovery";

describe("thread outbox follow-ups behind a rejected creation", () => {
  it("folds them into the task draft the rejected creation is restored into", async () => {
    const creation: QueuedThreadMessage = {
      ...queuedMessage({ messageId: "rejected-creation", text: "Original prompt" }),
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6-sol" },
      creation: {
        projectId: ProjectId.make("project-1"),
        workspaceMode: "local",
        branch: null,
        worktreePath: null,
      },
    };
    const followUp = {
      ...queuedMessage({
        messageId: "follow-up",
        text: "Also cover the empty state",
        fileUri: "file:///documents/supaterm-composer-attachments/follow-up.pdf",
      }),
      createdAt: "2026-08-24T12:01:00.000Z",
    };
    await harness.manager.enqueue(creation);
    await harness.manager.enqueue(followUp);

    await expect(restoreRejectedQueuedMessage(creation, "rejected by server")).resolves.toBe(
      "restored",
    );

    expect(
      composerDrafts.getComposerDraftSnapshot("new-task:restored-rejected-creation"),
    ).toMatchObject({
      text: "Original prompt\n\nAlso cover the empty state",
      attachments: followUp.attachments,
    });
    expect(remainingMessages()).toEqual([]);
    expect(harness.removePersistedFile).not.toHaveBeenCalled();
  });

  it("takes folded follow-ups back out with the task when its removal fails", async () => {
    const creation: QueuedThreadMessage = {
      ...queuedMessage({ messageId: "rejected-creation-retry", text: "Original prompt" }),
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6-sol" },
      creation: {
        projectId: ProjectId.make("project-1"),
        workspaceMode: "local",
        branch: null,
        worktreePath: null,
      },
    };
    const followUp = {
      ...queuedMessage({ messageId: "follow-up-retry", text: "Also cover the empty state" }),
      createdAt: "2026-08-24T12:01:00.000Z",
    };
    await harness.manager.enqueue(creation);
    await harness.manager.enqueue(followUp);
    const removeSpy = vi
      .spyOn(harness.manager, "remove")
      .mockRejectedValueOnce(new Error("storage unavailable"));

    try {
      await expect(restoreRejectedQueuedMessage(creation, "rejected by server")).resolves.toBe(
        "retry",
      );
      expect(remainingMessages().map((message) => message.messageId)).toEqual([
        creation.messageId,
        followUp.messageId,
      ]);
      expect(appAtomRegistry.get(pendingThreadCreationOutcomesAtom)).toEqual({});

      await expect(restoreRejectedQueuedMessage(creation, "rejected by server")).resolves.toBe(
        "restored",
      );
      expect(
        composerDrafts.getComposerDraftSnapshot("new-task:restored-rejected-creation-retry").text,
      ).toBe("Original prompt\n\nAlso cover the empty state");
      expect(remainingMessages()).toEqual([]);
    } finally {
      removeSpy.mockRestore();
    }
  });

  it("keeps a follow-up's content in the draft when it cannot leave the queue", async () => {
    const creation: QueuedThreadMessage = {
      ...queuedMessage({ messageId: "rejected-creation-stuck", text: "Original prompt" }),
      creation: {
        projectId: ProjectId.make("project-1"),
        workspaceMode: "local",
        branch: null,
        worktreePath: null,
      },
    };
    const followUp = {
      ...queuedMessage({ messageId: "follow-up-stuck", text: "Also cover the empty state" }),
      createdAt: "2026-08-24T12:01:00.000Z",
    };
    await harness.manager.enqueue(creation);
    await harness.manager.enqueue(followUp);
    const remove = harness.manager.remove.bind(harness.manager);
    const removeSpy = vi
      .spyOn(harness.manager, "remove")
      .mockImplementation((message, ...rest) =>
        message.messageId === followUp.messageId
          ? Promise.reject(new Error("storage unavailable"))
          : remove(message, ...rest),
      );

    try {
      await expect(restoreRejectedQueuedMessage(creation, "rejected by server")).resolves.toBe(
        "restored",
      );
      expect(
        composerDrafts.getComposerDraftSnapshot("new-task:restored-rejected-creation-stuck").text,
      ).toBe("Original prompt\n\nAlso cover the empty state");
      expect(remainingMessages().map((message) => message.messageId)).toEqual([followUp.messageId]);
    } finally {
      removeSpy.mockRestore();
    }
  });
  it("folds a follow-up queued while the restore runs", async () => {
    const creation: QueuedThreadMessage = {
      ...queuedMessage({ messageId: "rejected-creation-late", text: "Original prompt" }),
      creation: {
        projectId: ProjectId.make("project-1"),
        workspaceMode: "local",
        branch: null,
        worktreePath: null,
      },
    };
    const followUp = {
      ...queuedMessage({ messageId: "follow-up-early", text: "Also cover the empty state" }),
      createdAt: "2026-08-24T12:01:00.000Z",
    };
    const lateFollowUp = {
      ...queuedMessage({ messageId: "follow-up-late", text: "And the error state" }),
      createdAt: "2026-08-24T12:02:00.000Z",
    };
    await harness.manager.enqueue(creation);
    await harness.manager.enqueue(followUp);
    const remove = harness.manager.remove.bind(harness.manager);
    const removeSpy = vi
      .spyOn(harness.manager, "remove")
      .mockImplementation(async (message, ...rest) => {
        if (message.messageId === creation.messageId) await harness.manager.enqueue(lateFollowUp);
        return remove(message, ...rest);
      });

    try {
      await expect(restoreRejectedQueuedMessage(creation, "rejected by server")).resolves.toBe(
        "restored",
      );
      expect(
        composerDrafts.getComposerDraftSnapshot("new-task:restored-rejected-creation-late").text,
      ).toBe("Original prompt\n\nAlso cover the empty state\n\nAnd the error state");
      expect(remainingMessages()).toEqual([]);
    } finally {
      removeSpy.mockRestore();
    }
  });
});

describe("thread outbox recovery rollback", () => {
  it("preserves inline context from setup edits when reopening a failed task", async () => {
    const message = queuedMessage({ messageId: "failed-context", text: "Original prompt" });
    const sourceKey = `${message.environmentId}:${message.threadId}`;
    const targetKey = "new-task:restored-failed-context";
    const record = {
      version: 1 as const,
      kind: "mention" as const,
      contextId: ComposerContextId.make("setup-file"),
      label: "Checkout.tsx",
      path: "src/Checkout.tsx",
    };
    const context = { version: 1 as const, records: [record] };
    const text = "[Checkout.tsx](supaterm-context://v1/mention/setup-file)";
    appAtomRegistry.set(composerDrafts.composerDraftsAtom, {
      [targetKey]: { text: message.text, attachments: [] },
      [sourceKey]: { text, context, attachments: [] },
    });
    await recoverFailedThreadDraft(message);
    expect(composerDrafts.getComposerDraftSnapshot(targetKey)).toMatchObject({
      text: `Original prompt\n\n${text}`,
      context,
    });
    expect(composerDrafts.getComposerDraftSnapshot(sourceKey).context).toBeUndefined();
  });

  it("reopens a rejected task with setup edits and every attachment, even above the send cap", async () => {
    const message = queuedMessage({ messageId: "failed-setup", text: "Original prompt" });
    const sourceKey = `${message.environmentId}:${message.threadId}`;
    const targetKey = "new-task:restored-failed-setup";
    const files = Array.from(
      { length: 10 },
      (_, index) =>
        queuedMessage({
          messageId: `attachment-${index}`,
          text: "",
          fileUri: `file:///file-${index}`,
        }).attachments[0]!,
    );
    appAtomRegistry.set(composerDrafts.composerDraftsAtom, {
      [targetKey]: { text: message.text, attachments: files.slice(0, 8) },
      [sourceKey]: { text: "Please include tests", attachments: files.slice(8) },
    });
    await recoverFailedThreadDraft(message);
    expect(composerDrafts.getComposerDraftSnapshot(targetKey)).toMatchObject({
      text: "Original prompt\n\nPlease include tests",
      attachments: files,
    });
    expect(composerDrafts.getComposerDraftSnapshot(sourceKey)).toMatchObject({
      text: "",
      attachments: [],
    });
    await recoverFailedThreadDraft(message);
    expect(composerDrafts.getComposerDraftSnapshot(targetKey).text).toBe(
      "Original prompt\n\nPlease include tests",
    );
  });

  it("keeps setup edits recoverable when saving their recovery draft fails", async () => {
    const message = queuedMessage({ messageId: "failed-save", text: "Original prompt" });
    const sourceKey = `${message.environmentId}:${message.threadId}`;
    appAtomRegistry.set(composerDrafts.composerDraftsAtom, {
      "new-task:restored-failed-save": { text: message.text, attachments: [] },
      [sourceKey]: { text: "Follow-up", attachments: [] },
    });
    harness.draftFile.setWriteError(new Error("disk full"));
    await expect(recoverFailedThreadDraft(message)).rejects.toThrow("Composer draft persistence");
    expect(composerDrafts.getComposerDraftSnapshot(sourceKey).text).toBe("Follow-up");
    harness.draftFile.setWriteError(null);
    await recoverFailedThreadDraft(message);
    expect(composerDrafts.getComposerDraftSnapshot("new-task:restored-failed-save").text).toBe(
      "Original prompt\n\nFollow-up",
    );
  });

  it("restores a rejected new task as its own draft for the project", async () => {
    const message: QueuedThreadMessage = {
      ...queuedMessage({ messageId: "message-creation-restore", text: "new task text" }),
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6-sol" },
      creation: {
        projectId: ProjectId.make("project-1"),
        workspaceMode: "local",
        branch: null,
        worktreePath: null,
      },
    };
    await harness.manager.enqueue(message);

    await expect(restoreRejectedQueuedMessage(message, "rejected by server")).resolves.toBe(
      "restored",
    );

    expect(
      composerDrafts.getComposerDraftSnapshot(`new-task:restored-${message.messageId}`),
    ).toMatchObject({
      text: message.text,
      attachments: message.attachments,
      modelSelection: message.modelSelection,
      project: {
        environmentId: message.environmentId,
        projectId: message.creation!.projectId,
        createdAt: message.createdAt,
      },
    });
    expect(remainingMessages()).toEqual([]);
    expect(appAtomRegistry.get(threadComposerErrorsAtom)).toEqual({});
    expect(
      appAtomRegistry.get(pendingThreadCreationOutcomesAtom)[
        `${message.environmentId}:${message.threadId}`
      ],
    ).toEqual({ kind: "failed", message, reason: "rejected by server" });
  });

  it("drops an earlier recovery error once a rejected new task is restored", async () => {
    const message: QueuedThreadMessage = {
      ...queuedMessage({ messageId: "message-creation-retried", text: "new task text" }),
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6-sol" },
      creation: {
        projectId: ProjectId.make("project-1"),
        workspaceMode: "local",
        branch: null,
        worktreePath: null,
      },
    };
    await harness.manager.enqueue(message);
    harness.draftFile.setWriteError(new Error("disk full"));
    await expect(restoreRejectedQueuedMessage(message, "rejected by server")).resolves.toBe(
      "retry",
    );
    const threadKey = `${message.environmentId}:${message.threadId}`;
    expect(appAtomRegistry.get(threadComposerErrorsAtom)[threadKey]?.messageId).toBe(
      message.messageId,
    );

    harness.draftFile.setWriteError(null);
    await expect(restoreRejectedQueuedMessage(message, "rejected by server")).resolves.toBe(
      "restored",
    );

    expect(appAtomRegistry.get(threadComposerErrorsAtom)).toEqual({});
    expect(appAtomRegistry.get(pendingThreadCreationOutcomesAtom)[threadKey]?.kind).toBe("failed");
  });

  it("keeps a failed outcome until its thread screen consumes it", async () => {
    const message: QueuedThreadMessage = {
      ...queuedMessage({ messageId: "message-creation-kept", text: "new task text" }),
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6-sol" },
      creation: {
        projectId: ProjectId.make("project-1"),
        workspaceMode: "local",
        branch: null,
        worktreePath: null,
      },
    };
    await harness.manager.enqueue(message);
    await restoreRejectedQueuedMessage(message, "rejected by server");

    const key = `${message.environmentId}:${message.threadId}`;
    expect(appAtomRegistry.get(pendingThreadCreationOutcomesAtom)[key]?.kind).toBe("failed");

    clearPendingThreadCreationOutcome(key);
    expect(appAtomRegistry.get(pendingThreadCreationOutcomesAtom)[key]).toBeUndefined();
  });

  it("does not record a creation outcome for a rejected follow-up message", async () => {
    const message = queuedMessage({ messageId: "message-followup-restore", text: "follow up" });
    await harness.manager.enqueue(message);

    await expect(restoreRejectedQueuedMessage(message, "rejected")).resolves.toBe("restored");

    expect(appAtomRegistry.get(pendingThreadCreationOutcomesAtom)).toEqual({});
    expect(
      appAtomRegistry.get(threadComposerErrorsAtom)[`${message.environmentId}:${message.threadId}`],
    ).toEqual({ message: "rejected", messageId: message.messageId });
  });

  it("leaves no error when the restored text is resent before recovery finishes", async () => {
    const message = queuedMessage({ messageId: "message-resent", text: "resend me" });
    const threadKey = `${message.environmentId}:${message.threadId}`;
    await harness.manager.enqueue(message);
    const unsubscribe = appAtomRegistry.subscribe(composerDrafts.composerDraftsAtom, (drafts) => {
      if (drafts[threadKey]?.text === "resend me") {
        unsubscribe();
        clearThreadComposerError(threadKey);
        void composerDrafts.clearComposerDraftContent(threadKey);
      }
    });

    await expect(restoreRejectedQueuedMessage(message, "rejected")).resolves.toBe("restored");

    expect(appAtomRegistry.get(threadComposerErrorsAtom)).toEqual({});
  });

  it("withdraws the error when an edit makes the recovery back out", async () => {
    const message = queuedMessage({ messageId: "message-edited-mid-recovery", text: "edit me" });
    const threadKey = `${message.environmentId}:${message.threadId}`;
    await harness.manager.enqueue(message);
    const unsubscribe = appAtomRegistry.subscribe(composerDrafts.composerDraftsAtom, (drafts) => {
      if (drafts[threadKey]?.text === "edit me") {
        unsubscribe();
        appAtomRegistry.set(editingQueuedMessageIdsAtom, { [message.messageId]: "editing" });
      }
    });

    await expect(restoreRejectedQueuedMessage(message, "rejected")).resolves.toBe("deferred");

    expect(appAtomRegistry.get(threadComposerErrorsAtom)).toEqual({});
    expect(remainingMessages()).toEqual([message]);
  });

  it("rolls a failed recovery merge back so the retry cannot duplicate the text", async () => {
    const message = queuedMessage({ messageId: "message-restore", text: "queued text" });
    const draftKey = `${message.environmentId}:${message.threadId}`;
    appAtomRegistry.set(composerDrafts.composerDraftsAtom, {
      [draftKey]: { text: "typed offline", attachments: [] },
    });
    await harness.manager.enqueue(message);

    harness.draftFile.setWriteError(new Error("disk full"));
    await expect(restoreRejectedQueuedMessage(message, "too large")).resolves.toBe("retry");

    expect(composerDrafts.getComposerDraftSnapshot(draftKey).text).toBe("typed offline");
    expect(remainingMessages()).toEqual([message]);

    harness.draftFile.setWriteError(null);
    await expect(restoreRejectedQueuedMessage(message, "too large")).resolves.toBe("restored");

    expect(composerDrafts.getComposerDraftSnapshot(draftKey).text).toBe(
      "typed offline\n\nqueued text",
    );
    expect(remainingMessages()).toEqual([]);
    expect(appAtomRegistry.get(threadComposerErrorsAtom)[draftKey]?.message).toBe("too large");
  });
});
