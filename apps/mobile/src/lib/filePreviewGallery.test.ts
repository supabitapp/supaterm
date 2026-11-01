import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId } from "@supaterm/contracts";
import type { FilePreviewItem } from "../components/FilePreviewModal.types";
import { filePreviewGallery, filePreviewKey, settlePreviewGallery } from "./filePreviewGallery";

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
