import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { scopeThreadRef } from "@supaterm/client-runtime/environment";
import {
  CommandId,
  EnvironmentId,
  MessageId,
  ProviderInstanceId,
  ThreadId,
} from "@supaterm/contracts";

import { useComposerDraftStore, type ComposerFileAttachment } from "../composerDraftStore";
import { buildMessageContext, fileContextReference } from "../lib/composerContextRecords";
import { formatInlineContextReference } from "../lib/composerContextReferences";
import type { PendingThreadTurn } from "./threadOutbox";
import {
  buildEditedThreadOutboxTurn,
  captureOutboxAttachments,
  createThreadOutboxEditor,
} from "./threadOutboxEditing";

const transport = vi.hoisted(() => ({
  pause: vi.fn(),
  replace: vi.fn(),
  release: vi.fn(),
  uploaded: vi.fn(),
}));
vi.mock("./threadOutbox", () => ({
  webThreadOutbox: { pause: transport.pause },
  replaceThreadOutboxTurn: transport.replace,
}));
vi.mock("../lib/attachmentUploadQueue", () => ({
  releaseDraftAttachments: transport.release,
  getUploadedAttachments: transport.uploaded,
}));

const environmentId = EnvironmentId.make("environment");
const threadId = ThreadId.make("thread");
const threadTarget = scopeThreadRef(environmentId, threadId);
const file: ComposerFileAttachment = {
  type: "file",
  id: "saved-file",
  name: "notes.txt",
  mimeType: "text/plain",
  sizeBytes: 5,
  file: new File(["notes"], "notes.txt", { type: "text/plain" }),
};
function entry(): PendingThreadTurn {
  const context = buildMessageContext({
    terminalContexts: [],
    reviewComments: [],
    previewAnnotations: [],
    attachments: [{ attachment: file, attachmentId: file.id }],
  });
  if (!context) throw new Error("Expected file context");
  return {
    id: "message",
    scope: "environment:thread",
    createdAt: "2026-10-06T00:00:00Z",
    position: 1,
    status: "pending",
    attempted: false,
    attempts: 0,
    retryAt: 0,
    error: null,
    paused: false,
    pauseUntil: 0,
    payload: {
      environmentId,
      input: {
        commandId: CommandId.make("original-command"),
        threadId,
        message: {
          messageId: MessageId.make("message"),
          role: "user",
          text: `Original message ${formatInlineContextReference(fileContextReference(file))}`,
          attachments: [],
          context,
        },
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "original-model" },
        runtimeMode: "full-access",
        interactionMode: "default",
        dispatchMode: "queue",
      },
      localAttachments: [
        {
          id: file.id,
          type: file.type,
          name: file.name,
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
          bytes: file.file,
        },
      ],
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  transport.pause.mockResolvedValue(true);
  transport.replace.mockResolvedValue(null);
  useComposerDraftStore.setState({ draftsByThreadKey: {}, draftThreadsByThreadKey: {} });
});

describe("outbox editing in the composer", () => {
  it("keeps the current draft intact when opening and cancelling an edit", async () => {
    const store = useComposerDraftStore.getState();
    store.setPrompt(threadTarget, "My newer draft");
    store.addFiles(threadTarget, [file]);
    const originalDraft = store.getComposerDraft(threadTarget);
    const pending = entry();
    const editor = createThreadOutboxEditor("route");
    await editor.begin(pending);
    const editing = editor.getSnapshot();
    expect(editing?.draftTarget).not.toBe(threadTarget);
    expect(store.getComposerDraft(editing!.draftTarget)).toMatchObject({
      prompt: pending.payload.input.message.text,
      runtimeMode: "full-access",
      activeProvider: "codex",
    });
    store.setPrompt(editing!.draftTarget, "An unsaved edit");
    editor.cancel();
    expect(editor.getSnapshot()).toBeNull();
    expect(store.getComposerDraft(threadTarget)).toBe(originalDraft);
    expect(store.getComposerDraft(editing!.draftTarget)).toBeNull();
    expect(pending.payload.input.message.text).toContain("Original message");
    expect(transport.pause).toHaveBeenLastCalledWith("message", false);
  });

  it("saves into the pending message and returns to the preserved draft", async () => {
    const store = useComposerDraftStore.getState();
    store.setPrompt(threadTarget, "Next message draft");
    const editor = createThreadOutboxEditor("route");
    const pending = entry();
    await editor.begin(pending);
    const editing = editor.getSnapshot()!;
    const text = `Edited message ${formatInlineContextReference(fileContextReference(file))}`;
    store.setPrompt(editing.draftTarget, text);
    const payload = buildEditedThreadOutboxTurn({
      entry: pending,
      text,
      keptAttachmentIds: editing.keptAttachmentIds,
      addedAttachments: [],
    });
    await editor.save(payload);
    expect(transport.replace).toHaveBeenCalledWith(
      pending,
      expect.objectContaining({
        localAttachments: pending.payload.localAttachments,
        input: expect.objectContaining({
          message: expect.objectContaining({
            text,
            context: pending.payload.input.message.context,
          }),
        }),
      }),
    );
    expect(await payload.localAttachments[0]!.bytes!.text()).toBe("notes");
    expect(store.getComposerDraft(threadTarget)?.prompt).toBe("Next message draft");
    expect(editor.getSnapshot()).toBeNull();
  });

  it("leaves the edit in the composer if saving fails", async () => {
    const editor = createThreadOutboxEditor("route");
    await editor.begin(entry());
    const editing = editor.getSnapshot()!;
    useComposerDraftStore.getState().setPrompt(editing.draftTarget, "Keep this edit");
    transport.replace.mockRejectedValueOnce(new Error("quota exceeded"));
    await expect(editor.save(editing.entry.payload)).rejects.toThrow("quota exceeded");
    expect(editor.getSnapshot()).toBe(editing);
    expect(useComposerDraftStore.getState().getComposerDraft(editing.draftTarget)?.prompt).toBe(
      "Keep this edit",
    );
    expect(transport.pause).toHaveBeenLastCalledWith("message", true);
  });

  it("does not replace the composer when delivery has already started", async () => {
    const editor = createThreadOutboxEditor("route");
    transport.pause.mockResolvedValueOnce(false);
    await expect(editor.begin(entry())).rejects.toThrow("Delivery has already started");
    expect(editor.getSnapshot()).toBeNull();
  });

  it("ignores an edit that finishes pausing after the route has closed", async () => {
    let release = (_value: boolean) => {};
    transport.pause.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          release = resolve;
        }),
    );
    const editor = createThreadOutboxEditor("route");
    const opening = editor.begin(entry());
    editor.cancel();
    release(true);
    await opening;
    expect(editor.getSnapshot()).toBeNull();
    expect(transport.pause).toHaveBeenLastCalledWith("message", false);
  });

  it("removes attachment context with a removed attachment and retains newly added bytes", async () => {
    const pending = entry();
    const editor = createThreadOutboxEditor("route");
    await editor.begin(pending);
    editor.removeAttachment(file.id);
    const editing = editor.getSnapshot()!;
    const newFile = {
      ...pending.payload.localAttachments[0]!,
      id: "new-file",
      bytes: new Blob(["replacement"]),
    };
    const payload = buildEditedThreadOutboxTurn({
      entry: pending,
      text: useComposerDraftStore.getState().getComposerDraft(editing.draftTarget)?.prompt ?? "",
      keptAttachmentIds: editing.keptAttachmentIds,
      addedAttachments: [newFile],
    });
    expect(payload.input.message.text).toBe("Original message");
    expect(payload.input.message.context).toBeUndefined();
    expect(payload.localAttachments).toEqual([newFile]);
    expect(await payload.localAttachments[0]!.bytes!.text()).toBe("replacement");
    expect(pending.payload.localAttachments).toHaveLength(1);
  });

  it("rejects an empty edit after all attachments are removed", () => {
    expect(() =>
      buildEditedThreadOutboxTurn({
        entry: entry(),
        text: "",
        keptAttachmentIds: [],
        addedAttachments: [],
      }),
    ).toThrow("Enter a message or keep an attachment");
  });
});

describe("outbox attachment capture", () => {
  const recovered: ComposerFileAttachment = { ...file, id: "recovered-file", file: null };

  it("keeps the bytes of attachments the composer still holds", () => {
    expect(captureOutboxAttachments(environmentId, [file])).toEqual([
      {
        id: file.id,
        type: "file",
        name: file.name,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        bytes: file.file,
      },
    ]);
    expect(transport.uploaded).not.toHaveBeenCalled();
  });

  it("references the upload of an attachment recovered without bytes", () => {
    const uploaded = { ...file, id: "server-attachment" };
    transport.uploaded.mockReturnValueOnce([uploaded]);
    expect(captureOutboxAttachments(environmentId, [recovered])).toEqual([
      expect.objectContaining({ id: recovered.id, bytes: null, uploaded }),
    ]);
    expect(transport.uploaded).toHaveBeenCalledWith({ environmentId, images: [recovered] });
  });

  it("asks for the attachment again when neither bytes nor an upload remain", () => {
    transport.uploaded.mockReturnValueOnce(null);
    expect(() => captureOutboxAttachments(environmentId, [recovered])).toThrow(
      "Attach 'notes.txt' again before sending.",
    );
  });
});
