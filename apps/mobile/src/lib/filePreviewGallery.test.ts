import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId } from "@supaterm/contracts";
import type { FilePreviewItem } from "../components/FilePreviewModal.types";
import {
  filePreviewGallery,
  filePreviewKey,
  filePreviewName,
  settledPreviewGallery,
} from "./filePreviewGallery";

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

  it("preserves ordering, removes duplicates and retains the tapped transition source", () => {
    const selected = { ...second, sourceIdentifier: "thumbnail-2" };
    expect(filePreviewGallery(selected, [first, second, first])).toEqual([first, selected]);
  });

  it("keeps documents out of image groups and preserves a standalone image", () => {
    const document: FilePreviewItem = { kind: "pdf", uri: "file:///report.pdf" };
    expect(filePreviewGallery(first, [document])).toEqual([first]);
    expect(filePreviewGallery(document, [first, second])).toEqual([document]);
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

  it("uses actual filenames instead of captions with punctuation and paths", () => {
    expect(
      filePreviewName({
        ...first,
        name: 'main: "New thread in..." shows supabitapp/supacode-next',
      }),
    ).toBe("first.png");
    expect(
      filePreviewName({
        kind: "image",
        uri: "https://example.com/image",
        name: "test: before... / after",
      }),
    ).toBe("test_ before___ _ after");
    expect(
      filePreviewName({ kind: "document", uri: "file:///tmp/report.docx", name: "report.docx" }),
    ).toBe("report.docx");
  });
});
