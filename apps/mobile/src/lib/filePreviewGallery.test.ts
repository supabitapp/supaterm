import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId } from "@supaterm/contracts";
import type { FilePreviewItem } from "../components/FilePreviewModal.types";
import { filePreviewGallery, filePreviewKey, settledPreviewGallery } from "./filePreviewGallery";

const first: FilePreviewItem = { kind: "image", uri: "https://example.com/first.png" };
const second: FilePreviewItem = { kind: "image", uri: "https://example.com/second.png" };

describe("image preview groups", () => {
  it("waits for every sibling, then opens without the ones that failed to resolve", () => {
    const third: FilePreviewItem = { kind: "image", uri: "https://example.com/third.png" };
    const [firstKey, secondKey, thirdKey] = [first, second, third].map(filePreviewKey);
    const resolved = { [firstKey!]: "first" };
    expect(settledPreviewGallery([first, second, third], resolved, new Set())).toBeNull();
    expect(
      settledPreviewGallery([first, second, third], resolved, new Set([secondKey!])),
    ).toBeNull();
    expect(
      settledPreviewGallery(
        [first, second, third],
        { ...resolved, [thirdKey!]: "third" },
        new Set([secondKey!]),
      ),
    ).toEqual(["first", "third"]);
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
