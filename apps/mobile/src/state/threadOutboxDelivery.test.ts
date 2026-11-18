import { acknowledgedThreadMessagesAtom } from "./acknowledged-thread-messages";
import * as Effect from "effect/Effect";
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
import { describe, expect, it } from "@effect/vitest";
import { afterEach, beforeEach, vi } from "vite-plus/test";
import * as Fiber from "effect/Fiber";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";

import type { PreparedTurnAttachments } from "../lib/attachmentUpload";

const harness = vi.hoisted(() => ({
  canOperate: true,
  threadState: null as unknown as import("effect/reactivity").Atom.Writable<{
    readonly data: import("effect/Option").Option<{
      readonly messages: ReadonlyArray<{ readonly id: string }>;
    }>;
    readonly sequence: number;
  }>,
  manager: null as unknown as ReturnType<
    typeof import("./thread-outbox-manager").createThreadOutboxManager
  >,
  removePersistedFile: vi.fn(async () => undefined),
  removeOutboxMessage: vi.fn(async (_message: QueuedThreadMessage) => undefined),
  writeOutboxMessage: vi.fn(async (_message: QueuedThreadMessage) => undefined),
  prepareTurnAttachments: vi.fn<typeof import("../lib/attachmentUpload").prepareTurnAttachments>(),
  uploadVoice: vi.fn<typeof import("./transcription").uploadEnvironmentVoiceRecording>(),
  audioExists: true,
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
vi.mock("./composer-attachment-uploads", () => ({ uploadComposerAttachmentShared: vi.fn() }));

vi.mock("./transcription", () => ({ uploadEnvironmentVoiceRecording: harness.uploadVoice }));

vi.mock("./thread-outbox-audio", () => ({
  queuedVoiceRecordingFile: async (messageId: string) => ({
    exists: harness.audioExists,
    uri: `file:///documents/thread-outbox-audio/${messageId}.wav`,
  }),
  releaseUnusedQueuedVoiceRecordings: vi.fn(async () => undefined),
}));

vi.mock("./projects", () => ({ environmentProjects: {} }));

vi.mock("./workspace", () => ({ workspaceConnections: {} }));

vi.mock("./server", async () => {
  const { Atom } = await import("effect/reactivity");
  return { serverEnvironment: { configValueAtom: Atom.family(() => Atom.make(null)) } };
});

vi.mock("./git", () => ({ gitEnvironment: {} }));

vi.mock("./threads", async () => {
  const { Atom } = await import("effect/reactivity");
  const Option = await import("effect/Option");
  harness.threadState = Atom.make({
    data: Option.none<{ readonly messages: ReadonlyArray<{ readonly id: string }> }>(),
    sequence: 0,
  }).pipe(Atom.keepAlive);
  return {
    threadEnvironment: {},
    environmentThreadDetails: { stateAtom: () => harness.threadState },
  };
});

vi.mock("./vcs", () => ({ fetchVcsRefs: {} }));

vi.mock("./session", () => ({
  environmentSession: {},
  readEnvironmentScope: () => harness.canOperate,
  sessionHasScope: () => harness.canOperate,
}));

vi.mock("./use-thread-outbox", async () => {
  const { Atom } = await import("effect/reactivity");
  return {
    editingQueuedMessageIdsAtom: Atom.make<Record<string, "editing" | "paused" | "deleting">>(
      {},
    ).pipe(Atom.keepAlive),
    dispatchingQueuedMessageIdsAtom: Atom.make({}).pipe(Atom.keepAlive),
    retryingQueuedMessageIdsAtom: Atom.make({}).pipe(Atom.keepAlive),
    threadOutboxShellStatusesAtom: Atom.make(new Map()),
  };
});

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

import * as Option from "effect/Option";
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
  type DeliveryRetry,
  deliverQueuedVoiceMessage,
  prepareQueuedMessageAttachments,
  recoverEditedCreationAfterDelivery,
  removeAcknowledgedExistingThreadMessage,
  restoreRejectedQueuedMessage,
} from "./threadOutboxDelivery";

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
  appAtomRegistry.set(harness.threadState, { data: Option.none(), sequence: 0 });
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
  harness.uploadVoice.mockReset();
  harness.audioExists = true;
});

/** True once a delivery step handled its message, false when it asks to retry. */
const handled = (step: Effect.Effect<void, DeliveryRetry>) =>
  step.pipe(Effect.as(true), Effect.catchTags({ DeliveryRetry: () => Effect.succeed(false) }));

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
  it.effect("keeps a denied message queued without starting its attachment upload", () =>
    Effect.gen(function* () {
      const message = queuedMessage({
        messageId: "denied-queued-message",
        text: "Keep this queued",
        fileUri: "file:///documents/keep.pdf",
      });
      yield* Effect.promise(() => harness.manager.enqueue(message));
      harness.prepareTurnAttachments.mockReturnValueOnce(
        Effect.succeed({
          status: "ready",
          attachments: [],
          draftAttachments: message.attachments,
          pendingAttachmentIds: [],
        }),
      );
      harness.canOperate = false;
      expect(yield* prepareQueuedMessageAttachments(message)).toEqual({
        status: "abandoned",
      });
      expect(harness.prepareTurnAttachments).not.toHaveBeenCalled();
      expect(remainingMessages()).toEqual([message]);
    }),
  );

  it.effect("abandons reused uploads when an editor saves changed text during verification", () =>
    Effect.gen(function* () {
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
      harness.prepareTurnAttachments.mockImplementationOnce(() =>
        Effect.promise(() => {
          preparationStarted.resolve();
          return preparationBarrier.promise;
        }),
      );
      yield* Effect.promise(() => harness.manager.enqueue(message));
      appAtomRegistry.set(editingQueuedMessageIdsAtom, { [message.messageId]: "editing" });

      const preparation = yield* Effect.forkChild(prepareQueuedMessageAttachments(message), {
        startImmediately: true,
      });
      yield* Effect.promise(() => preparationStarted.promise);
      const edited = { ...message, text: "saved editor text" };
      yield* Effect.promise(() => harness.manager.update(edited));
      appAtomRegistry.set(editingQueuedMessageIdsAtom, {});
      preparationBarrier.resolve({
        status: "ready",
        attachments: [],
        draftAttachments: message.attachments,
        pendingAttachmentIds: ["pending-reused-upload"],
      });

      expect(yield* Fiber.join(preparation)).toEqual({ status: "abandoned" });
      expect(remainingMessages()).toEqual([edited]);
    }),
  );

  it.effect("keeps an unchanged queued payload ready after attachment reuse", () =>
    Effect.gen(function* () {
      const message = withReusedFileUpload(
        queuedMessage({
          messageId: "message-reused-upload-current",
          text: "unchanged text",
          fileUri: "file:///documents/supaterm-composer-attachments/current.pdf",
        }),
        "pending-reused-upload",
      );
      harness.prepareTurnAttachments.mockReturnValueOnce(
        Effect.succeed({
          status: "ready",
          attachments: [],
          draftAttachments: message.attachments,
          pendingAttachmentIds: ["pending-reused-upload"],
        }),
      );
      yield* Effect.promise(() => harness.manager.enqueue(message));
      const revision = harness.manager.revisionOf(message.messageId);
      appAtomRegistry.set(editingQueuedMessageIdsAtom, { [message.messageId]: "editing" });

      expect(yield* prepareQueuedMessageAttachments(message)).toMatchObject({
        status: "ready",
        persistedMessage: message,
        deliveryRevision: revision,
      });
    }),
  );

  it.effect("uses the known next revision after persisting uploaded references", () =>
    Effect.gen(function* () {
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
      harness.prepareTurnAttachments.mockImplementationOnce((input) =>
        Effect.gen(function* () {
          expect(yield* input.persistUploadedReferences!(uploadedAttachments)).toBe("persisted");
          return {
            status: "ready",
            attachments: [],
            draftAttachments: uploadedAttachments,
            pendingAttachmentIds: ["pending-new-upload"],
          } as const;
        }),
      );
      yield* Effect.promise(() => harness.manager.enqueue(message));
      const revision = harness.manager.revisionOf(message.messageId);

      const result = yield* prepareQueuedMessageAttachments(message);

      expect(result).toMatchObject({
        status: "ready",
        persistedMessage: { attachments: uploadedAttachments },
        deliveryRevision: revision + 1,
      });
      expect(harness.manager.revisionOf(message.messageId)).toBe(revision + 1);
    }),
  );

  it.effect("does not prepare a payload that was already replaced", () =>
    Effect.gen(function* () {
      const message = queuedMessage({ messageId: "message-stale-before-upload", text: "old" });
      yield* Effect.promise(() => harness.manager.enqueue(message));
      const edited = { ...message, text: "new" };
      yield* Effect.promise(() => harness.manager.update(edited));

      expect(yield* prepareQueuedMessageAttachments(message)).toEqual({
        status: "abandoned",
      });
      expect(harness.prepareTurnAttachments).not.toHaveBeenCalled();
      expect(remainingMessages()).toEqual([edited]);
    }),
  );
});

describe("thread outbox drain delivery cleanup", () => {
  it.effect("retries only cleanup after an acknowledged send removal fails", () =>
    Effect.gen(function* () {
      const message = queuedMessage({ messageId: "message-acknowledged", text: "delivered" });
      const acknowledged = new Set([message.messageId]);
      harness.removeOutboxMessage.mockRejectedValueOnce(new Error("storage unavailable"));
      yield* Effect.promise(() => harness.manager.enqueue(message));

      expect(yield* handled(removeAcknowledgedExistingThreadMessage(message, acknowledged))).toBe(
        false,
      );
      expect(remainingMessages()).toEqual([message]);
      expect(acknowledged).toEqual(new Set([message.messageId]));

      expect(yield* handled(removeAcknowledgedExistingThreadMessage(message, acknowledged))).toBe(
        true,
      );
      expect(remainingMessages()).toEqual([]);
      expect(acknowledged).toEqual(new Set());
    }),
  );

  it.effect(
    "keeps an edited message and its files when delivery cleanup loses the revision race",
    () =>
      Effect.gen(function* () {
        const message = queuedMessage({
          messageId: "message-edited",
          text: "original",
          fileUri: "file:///documents/supaterm-composer-attachments/report.pdf",
        });
        yield* Effect.promise(() => harness.manager.enqueue(message));
        const deliveryRevision = harness.manager.revisionOf(message.messageId);
        const edited = { ...message, text: "edited while the turn delivered" };
        yield* Effect.promise(() => harness.manager.update(edited));

        expect(yield* completeQueuedMessageDelivery(message, deliveryRevision, undefined)).toBe(
          "edited",
        );

        expect(remainingMessages()).toEqual([edited]);
        expect(harness.removePersistedFile).not.toHaveBeenCalled();
      }),
  );

  it.effect("removes the delivered message when no edit was accepted", () =>
    Effect.gen(function* () {
      const message = queuedMessage({ messageId: "message-clean", text: "hello" });
      yield* Effect.promise(() => harness.manager.enqueue(message));
      const deliveryRevision = harness.manager.revisionOf(message.messageId);

      expect(yield* completeQueuedMessageDelivery(message, deliveryRevision, undefined)).toBe(
        "removed",
      );

      expect(remainingMessages()).toEqual([]);
      expect(appAtomRegistry.get(acknowledgedThreadMessagesAtom)).toEqual([message]);
    }),
  );

  it.effect("clears an error about the delivered message but keeps one about another message", () =>
    Effect.gen(function* () {
      const threadKey = "environment-1:thread-1";
      const retried = queuedMessage({ messageId: "message-retried", text: "retried" });
      yield* Effect.promise(() => harness.manager.enqueue(retried));
      setThreadComposerError(threadKey, "could not be restored", retried.messageId);

      yield* completeQueuedMessageDelivery(
        retried,
        harness.manager.revisionOf(retried.messageId),
        undefined,
      );
      expect(appAtomRegistry.get(threadComposerErrorsAtom)[threadKey]).toBeUndefined();

      const other = queuedMessage({ messageId: "message-other", text: "other" });
      yield* Effect.promise(() => harness.manager.enqueue(other));
      setThreadComposerError(threadKey, "rejected", "message-rejected");

      yield* completeQueuedMessageDelivery(
        other,
        harness.manager.revisionOf(other.messageId),
        undefined,
      );
      expect(appAtomRegistry.get(threadComposerErrorsAtom)[threadKey]?.message).toBe("rejected");
    }),
  );

  it.effect("keeps a delivered message when its editor opens during storage removal", () =>
    Effect.gen(function* () {
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
      yield* Effect.promise(() => harness.manager.enqueue(message));
      const deliveryRevision = harness.manager.revisionOf(message.messageId);

      const cleanup = yield* Effect.forkChild(
        completeQueuedMessageDelivery(message, deliveryRevision, undefined),
        { startImmediately: true },
      );
      yield* Effect.promise(() => removeStarted.promise);
      appAtomRegistry.set(editingQueuedMessageIdsAtom, { [message.messageId]: "editing" });
      removeBarrier.resolve();

      expect(yield* Fiber.join(cleanup)).toBe("edited");
      expect(remainingMessages()).toEqual([message]);
      expect(harness.removePersistedFile).not.toHaveBeenCalled();
    }),
  );
});

describe("thread outbox delivered creation recovery", () => {
  it.effect("keeps an edit accepted while the older payload is persisted to the draft", () =>
    Effect.gen(function* () {
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
        yield* Effect.promise(() => harness.manager.enqueue(message));
        const recovery = yield* Effect.forkChild(
          handled(recoverEditedCreationAfterDelivery(message)),
          { startImmediately: true },
        );
        yield* Effect.promise(() => mergeCompleted.promise);

        const newer = { ...message, text: "edited while recovery persisted the draft" };
        yield* Effect.promise(() => harness.manager.update(newer));

        releaseRecovery.resolve();
        expect(yield* Fiber.join(recovery)).toBe(false);

        expect(remainingMessages()).toEqual([newer]);
        expect(
          composerDrafts.getComposerDraftSnapshot(`${message.environmentId}:${message.threadId}`),
        ).toMatchObject({ text: message.text, attachments: [] });
        expect(harness.removePersistedFile).not.toHaveBeenCalled();
      } finally {
        releaseRecovery.resolve();
        mergeSpy.mockRestore();
      }
    }),
  );

  it.effect("leaves recovery to an editor that opens while the draft persists", () =>
    Effect.gen(function* () {
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
        yield* Effect.promise(() => harness.manager.enqueue(message));
        const recovery = yield* Effect.forkChild(
          handled(recoverEditedCreationAfterDelivery(message)),
          { startImmediately: true },
        );
        yield* Effect.promise(() => mergeCompleted.promise);
        appAtomRegistry.set(editingQueuedMessageIdsAtom, { [message.messageId]: "editing" });

        releaseRecovery.resolve();
        expect(yield* Fiber.join(recovery)).toBe(true);

        expect(remainingMessages()).toEqual([message]);
        expect(
          composerDrafts.getComposerDraftSnapshot(`${message.environmentId}:${message.threadId}`),
        ).toMatchObject({ text: message.text, attachments: [] });
        expect(harness.removePersistedFile).not.toHaveBeenCalled();
      } finally {
        releaseRecovery.resolve();
        mergeSpy.mockRestore();
      }
    }),
  );

  it.effect("retries a failed removal without duplicating recovered draft content", () =>
    Effect.gen(function* () {
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
        yield* Effect.promise(() => harness.manager.enqueue(message));

        expect(yield* handled(recoverEditedCreationAfterDelivery(message))).toBe(false);
        expect(remainingMessages()).toEqual([message]);

        expect(yield* handled(recoverEditedCreationAfterDelivery(message))).toBe(true);

        const draft = composerDrafts.getComposerDraftSnapshot(draftKey);
        expect(draft.text).toBe(message.text);
        expect(draft.attachments).toEqual(message.attachments);
        expect(remainingMessages()).toEqual([]);
        expect(harness.removePersistedFile).not.toHaveBeenCalled();
      } finally {
        removeSpy.mockRestore();
      }
    }),
  );

  it.effect("keeps the queue entry when the recovered draft cannot persist", () =>
    Effect.gen(function* () {
      const message = queuedMessage({
        messageId: "message-recovery-persistence",
        text: "recover after persistence returns",
      });
      yield* Effect.promise(() => harness.manager.enqueue(message));
      harness.draftFile.setWriteError(new Error("disk full"));

      expect(yield* handled(recoverEditedCreationAfterDelivery(message))).toBe(false);

      expect(remainingMessages()).toEqual([message]);
    }),
  );
});

describe("thread outbox follow-ups behind a rejected creation", () => {
  it.effect("folds them into the task draft the rejected creation is restored into", () =>
    Effect.gen(function* () {
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
      yield* Effect.promise(() => harness.manager.enqueue(creation));
      yield* Effect.promise(() => harness.manager.enqueue(followUp));

      expect(yield* restoreRejectedQueuedMessage(creation, "rejected by server")).toBe("restored");

      expect(
        composerDrafts.getComposerDraftSnapshot("new-task:restored-rejected-creation"),
      ).toMatchObject({
        text: "Original prompt\n\nAlso cover the empty state",
        attachments: followUp.attachments,
      });
      expect(remainingMessages()).toEqual([]);
      expect(harness.removePersistedFile).not.toHaveBeenCalled();
    }),
  );

  it.effect("takes folded follow-ups back out with the task when its removal fails", () =>
    Effect.gen(function* () {
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
      yield* Effect.promise(() => harness.manager.enqueue(creation));
      yield* Effect.promise(() => harness.manager.enqueue(followUp));
      const removeSpy = vi
        .spyOn(harness.manager, "remove")
        .mockRejectedValueOnce(new Error("storage unavailable"));

      try {
        expect(yield* restoreRejectedQueuedMessage(creation, "rejected by server")).toBe("retry");
        expect(remainingMessages().map((message) => message.messageId)).toEqual([
          creation.messageId,
          followUp.messageId,
        ]);
        expect(appAtomRegistry.get(pendingThreadCreationOutcomesAtom)).toEqual({});

        expect(yield* restoreRejectedQueuedMessage(creation, "rejected by server")).toBe(
          "restored",
        );
        expect(
          composerDrafts.getComposerDraftSnapshot("new-task:restored-rejected-creation-retry").text,
        ).toBe("Original prompt\n\nAlso cover the empty state");
        expect(remainingMessages()).toEqual([]);
      } finally {
        removeSpy.mockRestore();
      }
    }),
  );

  it.effect("keeps a follow-up's content in the draft when it cannot leave the queue", () =>
    Effect.gen(function* () {
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
      yield* Effect.promise(() => harness.manager.enqueue(creation));
      yield* Effect.promise(() => harness.manager.enqueue(followUp));
      const remove = harness.manager.remove.bind(harness.manager);
      const removeSpy = vi
        .spyOn(harness.manager, "remove")
        .mockImplementation((message, ...rest) =>
          message.messageId === followUp.messageId
            ? Promise.reject(new Error("storage unavailable"))
            : remove(message, ...rest),
        );

      try {
        expect(yield* restoreRejectedQueuedMessage(creation, "rejected by server")).toBe(
          "restored",
        );
        expect(
          composerDrafts.getComposerDraftSnapshot("new-task:restored-rejected-creation-stuck").text,
        ).toBe("Original prompt\n\nAlso cover the empty state");
        expect(remainingMessages().map((message) => message.messageId)).toEqual([
          followUp.messageId,
        ]);
      } finally {
        removeSpy.mockRestore();
      }
    }),
  );
  it.effect("folds a follow-up queued while the restore runs", () =>
    Effect.gen(function* () {
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
      yield* Effect.promise(() => harness.manager.enqueue(creation));
      yield* Effect.promise(() => harness.manager.enqueue(followUp));
      const remove = harness.manager.remove.bind(harness.manager);
      const removeSpy = vi
        .spyOn(harness.manager, "remove")
        .mockImplementation(async (message, ...rest) => {
          if (message.messageId === creation.messageId) await harness.manager.enqueue(lateFollowUp);
          return remove(message, ...rest);
        });

      try {
        expect(yield* restoreRejectedQueuedMessage(creation, "rejected by server")).toBe(
          "restored",
        );
        expect(
          composerDrafts.getComposerDraftSnapshot("new-task:restored-rejected-creation-late").text,
        ).toBe("Original prompt\n\nAlso cover the empty state\n\nAnd the error state");
        expect(remainingMessages()).toEqual([]);
      } finally {
        removeSpy.mockRestore();
      }
    }),
  );
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

  it.effect("restores a rejected new task as its own draft for the project", () =>
    Effect.gen(function* () {
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
      yield* Effect.promise(() => harness.manager.enqueue(message));

      expect(yield* restoreRejectedQueuedMessage(message, "rejected by server")).toBe("restored");

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
    }),
  );

  it.effect("drops an earlier recovery error once a rejected new task is restored", () =>
    Effect.gen(function* () {
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
      yield* Effect.promise(() => harness.manager.enqueue(message));
      harness.draftFile.setWriteError(new Error("disk full"));
      expect(yield* restoreRejectedQueuedMessage(message, "rejected by server")).toBe("retry");
      const threadKey = `${message.environmentId}:${message.threadId}`;
      expect(appAtomRegistry.get(threadComposerErrorsAtom)[threadKey]?.messageId).toBe(
        message.messageId,
      );

      harness.draftFile.setWriteError(null);
      expect(yield* restoreRejectedQueuedMessage(message, "rejected by server")).toBe("restored");

      expect(appAtomRegistry.get(threadComposerErrorsAtom)).toEqual({});
      expect(appAtomRegistry.get(pendingThreadCreationOutcomesAtom)[threadKey]?.kind).toBe(
        "failed",
      );
    }),
  );

  it.effect("keeps a failed outcome until its thread screen consumes it", () =>
    Effect.gen(function* () {
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
      yield* Effect.promise(() => harness.manager.enqueue(message));
      yield* restoreRejectedQueuedMessage(message, "rejected by server");

      const key = `${message.environmentId}:${message.threadId}`;
      expect(appAtomRegistry.get(pendingThreadCreationOutcomesAtom)[key]?.kind).toBe("failed");

      clearPendingThreadCreationOutcome(key);
      expect(appAtomRegistry.get(pendingThreadCreationOutcomesAtom)[key]).toBeUndefined();
    }),
  );

  it.effect("does not record a creation outcome for a rejected follow-up message", () =>
    Effect.gen(function* () {
      const message = queuedMessage({ messageId: "message-followup-restore", text: "follow up" });
      yield* Effect.promise(() => harness.manager.enqueue(message));

      expect(yield* restoreRejectedQueuedMessage(message, "rejected")).toBe("restored");

      expect(appAtomRegistry.get(pendingThreadCreationOutcomesAtom)).toEqual({});
      expect(
        appAtomRegistry.get(threadComposerErrorsAtom)[
          `${message.environmentId}:${message.threadId}`
        ],
      ).toEqual({ message: "rejected", messageId: message.messageId });
    }),
  );

  it.effect("leaves no error when the restored text is resent before recovery finishes", () =>
    Effect.gen(function* () {
      const message = queuedMessage({ messageId: "message-resent", text: "resend me" });
      const threadKey = `${message.environmentId}:${message.threadId}`;
      yield* Effect.promise(() => harness.manager.enqueue(message));
      const unsubscribe = appAtomRegistry.subscribe(composerDrafts.composerDraftsAtom, (drafts) => {
        if (drafts[threadKey]?.text === "resend me") {
          unsubscribe();
          clearThreadComposerError(threadKey);
          void composerDrafts.clearComposerDraftContent(threadKey);
        }
      });

      expect(yield* restoreRejectedQueuedMessage(message, "rejected")).toBe("restored");

      expect(appAtomRegistry.get(threadComposerErrorsAtom)).toEqual({});
    }),
  );

  it.effect("withdraws the error when an edit makes the recovery back out", () =>
    Effect.gen(function* () {
      const message = queuedMessage({ messageId: "message-edited-mid-recovery", text: "edit me" });
      const threadKey = `${message.environmentId}:${message.threadId}`;
      yield* Effect.promise(() => harness.manager.enqueue(message));
      const unsubscribe = appAtomRegistry.subscribe(composerDrafts.composerDraftsAtom, (drafts) => {
        if (drafts[threadKey]?.text === "edit me") {
          unsubscribe();
          appAtomRegistry.set(editingQueuedMessageIdsAtom, { [message.messageId]: "editing" });
        }
      });

      expect(yield* restoreRejectedQueuedMessage(message, "rejected")).toBe("deferred");

      expect(appAtomRegistry.get(threadComposerErrorsAtom)).toEqual({});
      expect(remainingMessages()).toEqual([message]);
    }),
  );

  it.effect("rolls a failed recovery merge back so the retry cannot duplicate the text", () =>
    Effect.gen(function* () {
      const message = queuedMessage({ messageId: "message-restore", text: "queued text" });
      const draftKey = `${message.environmentId}:${message.threadId}`;
      appAtomRegistry.set(composerDrafts.composerDraftsAtom, {
        [draftKey]: { text: "typed offline", attachments: [] },
      });
      yield* Effect.promise(() => harness.manager.enqueue(message));

      harness.draftFile.setWriteError(new Error("disk full"));
      expect(yield* restoreRejectedQueuedMessage(message, "too large")).toBe("retry");

      expect(composerDrafts.getComposerDraftSnapshot(draftKey).text).toBe("typed offline");
      expect(remainingMessages()).toEqual([message]);

      harness.draftFile.setWriteError(null);
      expect(yield* restoreRejectedQueuedMessage(message, "too large")).toBe("restored");

      expect(composerDrafts.getComposerDraftSnapshot(draftKey).text).toBe(
        "typed offline\n\nqueued text",
      );
      expect(remainingMessages()).toEqual([]);
      expect(appAtomRegistry.get(threadComposerErrorsAtom)[draftKey]?.message).toBe("too large");
    }),
  );

  it.effect("keeps text typed while a failed recovery merge was persisting", () =>
    Effect.gen(function* () {
      const message = queuedMessage({
        messageId: "message-typed-mid-restore",
        text: "queued text",
      });
      const draftKey = `${message.environmentId}:${message.threadId}`;
      appAtomRegistry.set(composerDrafts.composerDraftsAtom, {
        [draftKey]: { text: "typed offline", attachments: [] },
      });
      yield* Effect.promise(() => harness.manager.enqueue(message));
      const unsubscribe = appAtomRegistry.subscribe(composerDrafts.composerDraftsAtom, (drafts) => {
        if (drafts[draftKey]?.text === "typed offline\n\nqueued text") {
          unsubscribe();
          queueMicrotask(() =>
            composerDrafts.setComposerDraftText(draftKey, "typed offline\n\nqueued text, again"),
          );
        }
      });

      harness.draftFile.setWriteError(new Error("disk full"));
      expect(yield* restoreRejectedQueuedMessage(message, "too large")).toBe("retry");

      expect(composerDrafts.getComposerDraftSnapshot(draftKey).text).toBe("typed offline, again");
      expect(remainingMessages()).toEqual([message]);
    }),
  );
});

describe("queued voice message delivery", () => {
  const modelSelection = { instanceId: ProviderInstanceId.make("claudeAgent"), model: "opus" };
  const voiceMessage = (): QueuedThreadMessage => ({
    ...queuedMessage({ messageId: "voice-1", text: "" }),
    dispatchMode: "queue",
    voice: { durationMs: 3_000, sizeBytes: 96_044, language: "en-US" },
  });
  const enqueue = async (message: QueuedThreadMessage) => {
    await harness.manager.enqueue(message);
    return message;
  };

  it.effect("has the environment send the recording under the message's own ids", () =>
    Effect.gen(function* () {
      const message = yield* Effect.promise(() => enqueue(voiceMessage()));
      harness.uploadVoice.mockResolvedValue({
        text: "ship it",
        submission: { status: "sent", sequence: 3 },
      });

      const delivery = yield* deliverQueuedVoiceMessage(message, modelSelection);

      expect(harness.uploadVoice).toHaveBeenCalledWith({
        environmentId: message.environmentId,
        uri: "file:///documents/thread-outbox-audio/voice-1.wav",
        request: {
          sizeBytes: 96_044,
          language: "en-US",
          submit: {
            threadId: message.threadId,
            commandId: message.commandId,
            messageId: message.messageId,
            modelSelection,
            delivery: "queue",
            creationSource: "mobile",
          },
        },
      });
      const { voice: _, ...sent } = message;
      expect(delivery).toMatchObject({
        status: "delivered",
        message: { ...sent, text: "ship it" },
        sequence: 3,
      });
    }),
  );

  it.effect(
    "collects a streamed recording without its audio only under the id it streamed with",
    () =>
      Effect.gen(function* () {
        harness.uploadVoice.mockResolvedValue({
          text: "ship it",
          submission: { status: "sent", sequence: 3 },
        });
        const base = voiceMessage();
        const streamed = yield* Effect.promise(() =>
          enqueue({
            ...base,
            voice: { ...base.voice!, streamedUploadId: base.commandId },
          }),
        );
        const renamed = yield* Effect.promise(() =>
          enqueue({
            ...queuedMessage({ messageId: "voice-2", text: "" }),
            voice: { ...base.voice!, streamedUploadId: base.commandId },
          }),
        );

        yield* deliverQueuedVoiceMessage(streamed, modelSelection);
        yield* deliverQueuedVoiceMessage(renamed, modelSelection);

        expect(harness.uploadVoice.mock.calls.map(([upload]) => upload.streamed)).toEqual([
          true,
          undefined,
        ]);
      }),
  );

  it.effect("holds a message whose recording is gone without uploading", () =>
    Effect.gen(function* () {
      harness.audioExists = false;
      const message = yield* Effect.promise(() => enqueue(voiceMessage()));

      expect(yield* deliverQueuedVoiceMessage(message, modelSelection)).toEqual({ status: "held" });
      expect(harness.uploadVoice).not.toHaveBeenCalled();
      expect(remainingMessages()[0]?.failure).toBe(
        "The recording is no longer available. Record it again.",
      );
    }),
  );
});
