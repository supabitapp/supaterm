import { acknowledgedThreadMessagesAtom } from "./acknowledged-thread-messages";
import { CommandId, EnvironmentId, MessageId, ThreadId } from "@supaterm/contracts";
import { afterEach, beforeEach, vi } from "vite-plus/test";

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

vi.mock("./use-atom-command", () => ({
  useAtomCommand: () => async () => undefined,
}));

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
    useThreadOutboxMessages: () => ({}),
    useThreadOutboxShellStatuses: () => new Map(),
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
import { pendingThreadCreationOutcomesAtom } from "./pending-thread-creation";
import { threadComposerErrorsAtom } from "./thread-composer-error";
import type { QueuedThreadMessage } from "./thread-outbox-model";

import * as composerDrafts from "./use-composer-drafts";

import { editingQueuedMessageIdsAtom } from "./use-thread-outbox";

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
});

export { harness, queuedMessage, withReusedFileUpload, remainingMessages };
