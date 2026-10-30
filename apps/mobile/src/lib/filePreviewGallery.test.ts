import { describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ThreadId } from "@supaterm/contracts";
import type { FilePreviewItem } from "../components/FilePreviewModal.types";
import type { DraftComposerAttachment } from "./composerImages";
import { composerImageGallery } from "./composerImageGallery";
import { messageImageGallery } from "../features/threads/messageImageGallery";
import { filePreviewGallery, filePreviewKey, settlePreviewGallery } from "./filePreviewGallery";

vi.mock("./uuid", () => ({}));

describe("image preview groups", () => {
  it("waits for every sibling, then opens without the ones that failed to resolve", async () => {
    const third = Promise.withResolvers<{ uri: string } | null>();
    let settled = false;
    const opening = settlePreviewGallery(
      [Promise.resolve({ uri: "first" }), Promise.reject(new Error("moved")), third.promise],
      0,
    ).finally(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    third.resolve({ uri: "third" });
    await expect(opening).resolves.toEqual({
      selected: { uri: "first" },
      gallery: [{ uri: "first" }, { uri: "third" }],
    });
  });

  it("fails at once when the selected item cannot resolve", async () => {
    const sibling = Promise.withResolvers<{ uri: string } | null>();
    await expect(
      settlePreviewGallery([sibling.promise, Promise.reject(new Error("deleted"))], 1),
    ).rejects.toThrow("deleted");
  });

  it.each([false, true])(
    "keeps one entry per image through upload and delivery (file: %s)",
    (fileBacked) => {
      const environmentId = EnvironmentId.make("test");
      const context = { environmentId, threadId: ThreadId.make("thread"), workspaceRoot: null };
      const attachments: DraftComposerAttachment[] = ["a", "b"].map((id) => ({
        id,
        type: "image",
        name: `${id}.png`,
        mimeType: "image/png",
        sizeBytes: 3,
        previewUri: `data:image/png;base64,${id}`,
        ...(fileBacked ? { fileUri: `file:///documents/${id}.png` } : {}),
      }));
      const delivered = (id: string) =>
        messageImageGallery(
          {
            text: "",
            attachments: [
              {
                type: "image",
                id: `uploaded-${id}`,
                name: `${id}.png`,
                mimeType: "image/png",
                sizeBytes: 3,
              },
            ],
          },
          context,
        )[0]!;
      const local = composerImageGallery(attachments, environmentId);
      const uploading = composerImageGallery(
        [{ ...attachments[0]!, uploadedAttachmentId: "uploaded-a" }, attachments[1]!],
        environmentId,
      );
      const uploaded = composerImageGallery(
        attachments.map((attachment) => ({
          ...attachment,
          uploadedAttachmentId: `uploaded-${attachment.id}`,
        })),
        environmentId,
      );
      for (const [selected, gallery] of [
        [local[0]!, local],
        [delivered("a"), uploading],
        [uploading[1]!, uploading],
        [delivered("a"), uploaded],
        [delivered("a"), [...uploaded, delivered("a"), delivered("b")]],
        [delivered("a"), [delivered("a"), delivered("b")]],
      ] as const) {
        const result = filePreviewGallery(selected, gallery);
        expect(result).toHaveLength(2);
        expect(result.map(filePreviewKey)).toEqual([...new Set(gallery.map(filePreviewKey))]);
      }
      expect(composerImageGallery(attachments)).toEqual(local);
    },
  );

  it("matches remote originals despite metadata and property order differences", () => {
    const environmentId = EnvironmentId.make("test");
    const a: FilePreviewItem = {
      kind: "image",
      environmentId,
      resource: { _tag: "attachment", attachmentId: "a", fileName: "old.png" },
    };
    const b: FilePreviewItem = {
      kind: "image",
      environmentId,
      resource: {
        attachmentId: "a",
        _tag: "attachment",
        fileName: "new.png",
        mimeType: "image/png",
      },
    };
    expect(filePreviewKey(a)).toBe(filePreviewKey(b));
    expect(filePreviewGallery(b, [a])).toEqual([b]);
  });
});
