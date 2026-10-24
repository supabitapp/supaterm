import { acknowledgedThreadMessagesAtom } from "./acknowledged-thread-messages";
import {
  CommandId,
  ComposerContextId,
  EnvironmentId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type VcsListRefsResult,
} from "@supaterm/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";

import type { PreparedTurnAttachments } from "../lib/attachmentUpload";

const harness = vi.hoisted(() => ({
  canOperate: true,
  manager: null as unknown as ReturnType<
    typeof import("./thread-outbox-manager").createThreadOutboxManager
  >,
  removePersistedFile: vi.fn(async () => undefined),
  removeOutboxMessage: vi.fn(async (_message: QueuedThreadMessage) => undefined),
  writeOutboxMessage: vi.fn(async (_message: QueuedThreadMessage) => undefined),
  prepareTurnAttachments: vi.fn<typeof import("../lib/attachmentUpload").prepareTurnAttachments>(),
  draftFile: (() => {
    let document = "";
    let writeError: Error | null = null;
    return {
      setDocument(value: unknown) {
        document = JSON.stringify(value);
      },
      setWriteError(error: Error | null) {
        writeError = error;
      },
      Directory: class {
        create() {}
      },
      File: class {
        exists = true;
        parentDirectory = null;

        create() {}

        moveSync() {}

        async text() {
          return document;
        }

        write(value: string) {
          if (writeError) {
            throw writeError;
          }
          document = value;
        }
      },
    };
  })(),
}));

vi.mock("react-native", () => ({ Alert: { alert: vi.fn() } }));

vi.mock("expo-file-system", () => ({
  Directory: harness.draftFile.Directory,
  File: harness.draftFile.File,
  Paths: { document: "/documents" },
}));

vi.mock("../lib/composerImages", () => ({
  removePersistedComposerAttachmentFile: harness.removePersistedFile,
}));

vi.mock("../lib/uuid", () => ({
  uuidv4: () => "00000000-0000-4000-8000-000000000000",
  randomHex: () => "abcd",
}));

vi.mock("../lib/attachmentUpload", () => ({
  prepareTurnAttachments: harness.prepareTurnAttachments,
}));

vi.mock("./entities", () => ({
  useProjects: () => [],
  useServerConfigs: () => new Map(),
  useThreadShells: () => [],
}));

vi.mock("./server", async () => {
  const { Atom } = await import("effect/reactivity");
  return { serverEnvironment: { configValueAtom: Atom.family(() => Atom.make(null)) } };
});

vi.mock("./git", () => ({ gitEnvironment: {} }));

vi.mock("./threads", () => ({
  threadEnvironment: {},
}));

vi.mock("./vcs", () => ({ fetchVcsRefs: {} }));

vi.mock("./use-atom-command", () => ({
  useAtomCommand: () => async () => undefined,
}));

vi.mock("./session", () => ({
  readEnvironmentScope: () => harness.canOperate,
  useEnvironmentsWithScope: () => new Set(),
}));

vi.mock("./use-thread-outbox", async () => {
  const { Atom } = await import("effect/reactivity");
  return {
    editingQueuedMessageIdsAtom: Atom.make<Record<string, "editing" | "paused" | "deleting">>(
      {},
    ).pipe(Atom.keepAlive),
    useThreadOutboxMessages: () => ({}),
    useThreadOutboxShellStatuses: () => new Map(),
  };
});

vi.mock("./use-remote-environment-registry", () => ({
  useRemoteConnectionStatus: () => ({ connectedEnvironments: [] }),
}));

vi.mock("./thread-outbox", async () => {
  const { createThreadOutboxManager } = await import("./thread-outbox-manager");
  const { appAtomRegistry } = await import("./atom-registry");
  harness.manager = createThreadOutboxManager({
    registry: appAtomRegistry,
    storage: {
      load: async () => ({ messages: [], errors: [] }),
      write: (message) => harness.writeOutboxMessage(message),
      remove: (message) => harness.removeOutboxMessage(message),
    },
  });
  const manager = harness.manager;
  return {
    threadOutboxManager: manager,
    flushThreadOutbox: async () => undefined,
    confirmThreadOutboxMessageQueued: (message: never) => manager.confirmQueued(message),
    updateThreadOutboxMessage: (
      message: never,
      expectedRevision?: number,
      canUpdate?: () => boolean,
    ) => manager.update(message, expectedRevision, canUpdate),
    threadOutboxRevision: (messageId: never) => manager.revisionOf(messageId),
  };
});

import { appAtomRegistry } from "./atom-registry";
import {
  clearPendingThreadCreationOutcome,
  pendingThreadCreationOutcomesAtom,
} from "./pending-thread-creation";
import {
  clearThreadComposerError,
  setThreadComposerError,
  threadComposerErrorsAtom,
} from "./thread-composer-error";
import type { QueuedThreadMessage } from "./thread-outbox-model";
import { prepareQueuedThreadCreation } from "./queued-thread-creation";
import * as composerDrafts from "./use-composer-drafts";
import { recoverFailedThreadDraft } from "./recover-failed-thread-draft";
import { editingQueuedMessageIdsAtom } from "./use-thread-outbox";
import {
  completeQueuedMessageDelivery,
  prepareQueuedMessageAttachments,
  recoverEditedCreationAfterDelivery,
  removeAcknowledgedExistingThreadMessage,
  restoreRejectedQueuedMessage,
} from "./use-thread-outbox-drain";

function queuedMessage(input: {
  readonly messageId: string;
  readonly text: string;
  readonly fileUri?: string;
}): QueuedThreadMessage {
  return {
    environmentId: EnvironmentId.make("environment-1"),
    threadId: ThreadId.make("thread-1"),
    messageId: MessageId.make(input.messageId),
    commandId: CommandId.make(`command-${input.messageId}`),
    text: input.text,
    attachments: input.fileUri
      ? [
          {
            id: `file-${input.messageId}`,
            type: "file",
            name: "report.pdf",
            mimeType: "application/pdf",
            sizeBytes: 42,
            fileUri: input.fileUri,
          },
        ]
      : [],
    createdAt: "2026-08-24T12:00:00.000Z",
  };
}

function withReusedFileUpload(
  message: QueuedThreadMessage,
  attachmentId: string,
): QueuedThreadMessage {
  return {
    ...message,
    attachments: message.attachments.map((attachment) =>
      attachment.type === "file"
        ? {
            ...attachment,
            uploadedAttachmentId: attachmentId,
            uploadEnvironmentId: message.environmentId,
          }
        : attachment,
    ),
  };
}

function remainingMessages(): ReadonlyArray<QueuedThreadMessage> {
  return Object.values(appAtomRegistry.get(harness.manager.queuedMessagesByThreadKeyAtom)).flat();
}

beforeEach(() => {
  appAtomRegistry.set(acknowledgedThreadMessagesAtom, []);
  harness.canOperate = true;
  harness.draftFile.setDocument({ schemaVersion: 1, drafts: {} });
});

afterEach(() => {
  appAtomRegistry.set(harness.manager.queuedMessagesByThreadKeyAtom, {});
  appAtomRegistry.set(composerDrafts.composerDraftsAtom, {});
  appAtomRegistry.set(editingQueuedMessageIdsAtom, {});
  appAtomRegistry.set(pendingThreadCreationOutcomesAtom, {});
  appAtomRegistry.set(threadComposerErrorsAtom, {});
  harness.draftFile.setWriteError(null);
  harness.removePersistedFile.mockClear();
  harness.removeOutboxMessage.mockClear();
  harness.writeOutboxMessage.mockReset();
  harness.prepareTurnAttachments.mockReset();
});

describe("queued worktree branch resolution", () => {
  const refs: VcsListRefsResult = {
    isRepo: true,
    hasPrimaryRemote: true,
    nextCursor: null,
    totalCount: 2,
    refs: [
      {
        name: "feature/current",
        current: true,
        isDefault: false,
        isRemote: false,
        worktreePath: null,
      },
      { name: "main", current: false, isDefault: true, isRemote: false, worktreePath: null },
    ],
  };
  const task = (): QueuedThreadMessage => ({
    ...queuedMessage({ messageId: "message-default-base", text: "Create a new feature" }),
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    creation: {
      projectId: ProjectId.make("project-1"),
      projectCwd: "/repo",
      workspaceMode: "worktree",
      branch: null,
      worktreePath: null,
      useDefaultBranch: true,
      startFromOrigin: true,
    },
  });

  it("persists a concrete base before delivery and reuses it on retry", async () => {
    const message = task();
    const fetchRefs = vi.fn(async () => AsyncResult.success(refs));
    await harness.manager.enqueue(message);

    const result = await prepareQueuedThreadCreation(message, "/repo", fetchRefs);

    expect(AsyncResult.isSuccess(result)).toBe(true);
    if (!AsyncResult.isSuccess(result) || !result.value) throw new Error("No prepared task");
    expect(result.value.creation).toEqual({
      projectId: message.creation?.projectId,
      projectCwd: "/repo",
      workspaceMode: "worktree",
      branch: "main",
      worktreePath: null,
      startFromOrigin: true,
    });
    expect(remainingMessages()).toEqual([result.value.message]);
    expect(harness.writeOutboxMessage.mock.calls.at(-1)?.[0]).toBe(result.value.message);
    expect(fetchRefs).toHaveBeenCalledWith({
      environmentId: message.environmentId,
      input: { cwd: "/repo", limit: 100, refresh: true },
    });
    await prepareQueuedThreadCreation(result.value.message, "/repo", fetchRefs);
    expect(fetchRefs).toHaveBeenCalledTimes(1);
  });

  it.each(["local", "worktree"] as const)(
    "keeps an explicit %s workspace unchanged",
    async (mode) => {
      const initial = task();
      const message = {
        ...initial,
        creation: {
          ...initial.creation!,
          workspaceMode: mode,
          branch: "release",
          worktreePath: "/chosen",
        },
      };
      const fetchRefs = vi.fn(async () => AsyncResult.success(refs));
      await harness.manager.enqueue(message);

      const result = await prepareQueuedThreadCreation(message, "/repo", fetchRefs);

      expect(AsyncResult.isSuccess(result) && result.value?.message).toBe(message);
      expect(fetchRefs).not.toHaveBeenCalled();
    },
  );

  it("leaves a failed branch request queued for the caller to retry", async () => {
    const message = task();
    const failure = AsyncResult.failure<VcsListRefsResult, Error>(
      Cause.fail(new Error("Socket is not connected")),
    );
    await harness.manager.enqueue(message);

    const result = await prepareQueuedThreadCreation(message, "/repo", async () => failure);

    expect(AsyncResult.isFailure(result) && result.cause).toBe(failure.cause);
    expect(remainingMessages()).toEqual([message]);
  });

  it.each([true, false])(
    "reports an unresolvable base without changing workspace: isRepo=%s",
    async (isRepo) => {
      const message = task();
      await harness.manager.enqueue(message);

      const result = await prepareQueuedThreadCreation(message, "/repo", async () =>
        AsyncResult.success({ ...refs, isRepo, refs: [] }),
      );

      expect(AsyncResult.isFailure(result)).toBe(true);
      expect(remainingMessages()).toEqual([message]);
    },
  );

  it("preserves an edit accepted while the branch request is in flight", async () => {
    const message = task();
    const started = Promise.withResolvers<void>();
    const response = Promise.withResolvers<VcsListRefsResult>();
    await harness.manager.enqueue(message);
    const preparation = prepareQueuedThreadCreation(message, "/repo", async () => {
      started.resolve();
      return AsyncResult.success(await response.promise);
    });
    await started.promise;
    const edited = {
      ...message,
      text: "Edited prompt",
      creation: { ...message.creation!, branch: "release" },
    };
    await harness.manager.update(edited);
    response.resolve(refs);

    const result = await preparation;

    expect(AsyncResult.isSuccess(result) && result.value).toBeNull();
    expect(remainingMessages()).toEqual([edited]);
  });

  it("keeps the original durable payload when its editor opens during the branch write", async () => {
    const message = task();
    await harness.manager.enqueue(message);
    const revision = harness.manager.revisionOf(message.messageId);
    harness.writeOutboxMessage.mockImplementationOnce(async () => {
      appAtomRegistry.set(editingQueuedMessageIdsAtom, { [message.messageId]: "editing" });
    });

    const result = await prepareQueuedThreadCreation(message, "/repo", async () =>
      AsyncResult.success(refs),
    );

    expect(AsyncResult.isSuccess(result) && result.value).toBeNull();
    expect(remainingMessages()).toEqual([message]);
    expect(harness.manager.revisionOf(message.messageId)).toBe(revision);
    expect(harness.writeOutboxMessage.mock.calls.at(-1)?.[0]).toBe(message);
  });

  it("retains default-base intent when the resolved branch cannot be saved", async () => {
    const message = task();
    await harness.manager.enqueue(message);
    harness.writeOutboxMessage.mockRejectedValueOnce(new Error("Storage unavailable"));

    await expect(
      prepareQueuedThreadCreation(message, "/repo", async () => AsyncResult.success(refs)),
    ).rejects.toMatchObject({ operation: "update" });

    expect(remainingMessages()).toEqual([message]);
  });

  it("reports a failed durable restore after the editor takes ownership", async () => {
    const message = task();
    await harness.manager.enqueue(message);
    harness.writeOutboxMessage
      .mockImplementationOnce(async () => {
        appAtomRegistry.set(editingQueuedMessageIdsAtom, { [message.messageId]: "editing" });
      })
      .mockRejectedValueOnce(new Error("Storage unavailable"));

    await expect(
      prepareQueuedThreadCreation(message, "/repo", async () => AsyncResult.success(refs)),
    ).rejects.toMatchObject({ operation: "update" });

    expect(remainingMessages()).toEqual([message]);
  });
});

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

    await expect(completeQueuedMessageDelivery(message, deliveryRevision)).resolves.toBe("edited");

    expect(remainingMessages()).toEqual([edited]);
    expect(harness.removePersistedFile).not.toHaveBeenCalled();
  });

  it("removes the delivered message when no edit was accepted", async () => {
    const message = queuedMessage({ messageId: "message-clean", text: "hello" });
    await harness.manager.enqueue(message);
    const deliveryRevision = harness.manager.revisionOf(message.messageId);

    await expect(completeQueuedMessageDelivery(message, deliveryRevision)).resolves.toBe("removed");

    expect(remainingMessages()).toEqual([]);
    expect(appAtomRegistry.get(acknowledgedThreadMessagesAtom)).toEqual([message]);
  });

  it("clears an error about the delivered message but keeps one about another message", async () => {
    const threadKey = "environment-1:thread-1";
    const retried = queuedMessage({ messageId: "message-retried", text: "retried" });
    await harness.manager.enqueue(retried);
    setThreadComposerError(threadKey, "could not be restored", retried.messageId);

    await completeQueuedMessageDelivery(retried, harness.manager.revisionOf(retried.messageId));
    expect(appAtomRegistry.get(threadComposerErrorsAtom)[threadKey]).toBeUndefined();

    const other = queuedMessage({ messageId: "message-other", text: "other" });
    await harness.manager.enqueue(other);
    setThreadComposerError(threadKey, "rejected", "message-rejected");

    await completeQueuedMessageDelivery(other, harness.manager.revisionOf(other.messageId));
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

    const cleanup = completeQueuedMessageDelivery(message, deliveryRevision);
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
