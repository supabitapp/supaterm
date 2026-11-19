import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@supaterm/contracts";
import { scopeThreadRef } from "@supaterm/client-runtime/environment";
import {
  modelContextRecord,
  threadContextRecord,
} from "@supaterm/shared/composerContextReferences";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import {
  DraftId,
  useComposerDraftStore,
  type ComposerFileAttachment,
  type ComposerImageAttachment,
} from "../../composerDraftStore";
import { readAttachmentUpload, useAttachmentUploadStore } from "../../lib/attachmentUploadQueue";
import { prepareQueuedEditAttachments, recoverQueuedMessageEdit } from "./queuedMessageEdit";

const environmentId = EnvironmentId.make("remote-environment");
const threadTarget = scopeThreadRef(environmentId, ThreadId.make("thread:edit"));
const editTarget = DraftId.make("queued-edit:test");
const file: ComposerFileAttachment = {
  type: "file",
  id: "file:report",
  name: "report.pdf",
  mimeType: "application/pdf",
  sizeBytes: 6,
  file: new File(["report"], "report.pdf", { type: "application/pdf" }),
};
const image: ComposerImageAttachment = {
  type: "image",
  id: "image:screen",
  name: "screen.png",
  mimeType: "image/png",
  sizeBytes: 5,
  file: new File(["image"], "screen.png", { type: "image/png" }),
  previewUrl: "blob:screen",
};
const uploadedFile = {
  type: "file" as const,
  id: "upload:report",
  name: file.name,
  mimeType: file.mimeType,
  sizeBytes: file.sizeBytes,
};

describe("queued message file edits", () => {
  beforeEach(() => {
    useComposerDraftStore.setState({ draftsByThreadKey: {}, draftThreadsByThreadKey: {} });
  });

  it.each([
    { images: [], label: "file-only" },
    { images: [image], label: "mixed" },
  ])("preserves a generic file in a $label save", async ({ images }) => {
    const attachments = await prepareQueuedEditAttachments({
      existingAttachments: [],
      images,
      files: [file],
      uploadFiles: async () => [uploadedFile],
      readImage: async () => "data:image/png;base64,aW1hZ2U=",
    });
    expect(attachments.at(-1)).toEqual(uploadedFile);
    expect(attachments.length).toBe(images.length + 1);
    if (images.length > 0)
      expect(attachments[0]).toMatchObject({
        type: "image",
        dataUrl: "data:image/png;base64,aW1hZ2U=",
      });
  });

  it("fails a save instead of dropping a file whose upload is missing", async () => {
    await expect(
      prepareQueuedEditAttachments({
        existingAttachments: [],
        images: [image],
        files: [file],
        uploadFiles: async () => [],
        readImage: async () => "image",
      }),
    ).rejects.toThrow("Retry or remove");
  });

  it("keeps file-only edits when another client starts the queued run", () => {
    const store = useComposerDraftStore.getState();
    store.setPrompt(editTarget, "Original message");
    const elsewhere: ComposerFileAttachment = {
      ...uploadedFile,
      id: "file:elsewhere",
      name: "elsewhere.pdf",
      file: null,
      uploadedAttachmentId: "upload:elsewhere",
      uploadEnvironmentId: EnvironmentId.make("other-environment"),
    };
    store.addFiles(editTarget, [file, elsewhere]);
    expect(
      recoverQueuedMessageEdit({ editTarget, threadTarget, originalText: "Original message" }),
    ).toBe("kept");
    expect(store.getComposerDraft(threadTarget)?.prompt).toBe("Original message");
    const { uploadedAttachmentId: _id, uploadEnvironmentId: _env, ...reattach } = elsewhere;
    expect(store.getComposerDraft(threadTarget)?.files).toEqual([file, reattach]);
    expect(store.getComposerDraft(editTarget)).toBeNull();
  });

  it("keeps the mentions of a kept edit in the thread draft", () => {
    const store = useComposerDraftStore.getState();
    store.setPrompt(editTarget, "Edited message");
    const thread = threadContextRecord(
      scopeThreadRef(environmentId, ThreadId.make("thread:other")),
      "Other",
    );
    const model = modelContextRecord({
      instanceId: ProviderInstanceId.make("codex"),
      driver: ProviderDriverKind.make("codex"),
      model: "gpt-5.5",
      name: "GPT-5.5",
      providerName: "Codex",
    });
    store.setReferenceContexts(editTarget, [thread, model]);
    const editedPrompt = store.getComposerDraft(editTarget)!.prompt;
    expect(
      recoverQueuedMessageEdit({ editTarget, threadTarget, originalText: "Original message" }),
    ).toBe("kept");
    expect(store.getComposerDraft(editTarget)).toBeNull();
    expect(store.getComposerDraft(threadTarget)).toMatchObject({
      prompt: editedPrompt,
      referenceContexts: [thread, model],
    });
  });

  it("reports a removed queued attachment as an edit when the run leaves", () => {
    const store = useComposerDraftStore.getState();
    store.setPrompt(editTarget, "Original message");
    expect(
      recoverQueuedMessageEdit({
        editTarget,
        threadTarget,
        originalText: "Original message",
        removedExistingAttachment: true,
      }),
    ).toBe("kept");
    expect(store.getComposerDraft(threadTarget)?.prompt).toBe("Original message");
    store.clearComposerContent(threadTarget);
    expect(
      recoverQueuedMessageEdit({
        editTarget,
        threadTarget,
        originalText: "",
        removedExistingAttachment: true,
      }),
    ).toBe("discarded");
    expect(store.getComposerDraft(threadTarget)).toBeNull();
  });

  it("does not overwrite a separate draft when the queued run leaves", () => {
    const store = useComposerDraftStore.getState();
    store.setPrompt(threadTarget, "Separate draft");
    store.addFiles(editTarget, [file]);
    useAttachmentUploadStore.setState({
      uploadsByImageId: {
        [file.id]: { status: "ready", environmentId, attachmentId: uploadedFile.id },
      },
    });
    expect(recoverQueuedMessageEdit({ editTarget, threadTarget, originalText: "" })).toBe(
      "discarded",
    );
    expect(store.getComposerDraft(threadTarget)?.prompt).toBe("Separate draft");
    expect(store.getComposerDraft(editTarget)).toBeNull();
    expect(readAttachmentUpload(file.id)).toBeUndefined();
  });
});
