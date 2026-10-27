import { describe, expect, it } from "vite-plus/test";

describe("contextChipPresentation image detection", () => {
  it("treats a picture attached through the file picker as an image", async () => {
    const { contextChipPresentation } = await import("./composerChipPresentation");
    expect(
      contextChipPresentation("file", { kind: "file", name: "IMG_4997.PNG", mimeType: "" }),
    ).toEqual({ accent: "#d55665", icon: "image" });
    expect(
      contextChipPresentation("file", {
        kind: "file",
        name: "shot",
        mimeType: "image/jpeg",
      }),
    ).toEqual({ accent: "#d55665", icon: "image" });
  });

  it("leaves genuine documents and videos alone", async () => {
    const { contextChipPresentation } = await import("./composerChipPresentation");
    expect(
      contextChipPresentation("file", { kind: "file", name: "notes.txt", mimeType: "text/plain" }),
    ).toEqual({ accent: "#0090cd", icon: null });
    expect(
      contextChipPresentation("file", { kind: "file", name: "clip.mp4", mimeType: "video/mp4" }),
    ).toEqual({ accent: "#d06217", icon: "film" });
  });
});

describe("pull request chip status", () => {
  const chip = async (state: string, isDraft = false) => {
    const { contextChipPresentation } = await import("./composerChipPresentation");
    return contextChipPresentation("review-comment", {
      kind: "review-comment",
      sectionId: "pull-request:10978",
      pullRequest: { state, isDraft },
    });
  };

  it("gives composer and message chips web's per-state pull request glyphs", async () => {
    expect((await chip("open")).icon).toBe("git-pull-request");
    expect((await chip("open", true)).icon).toBe("git-pull-request-draft");
    expect((await chip("merged")).icon).toBe("git-merge");
    expect((await chip("closed")).icon).toBe("git-pull-request-closed");
  });
});

describe("contextChipIcon", () => {
  it("draws the chip's own glyph, or the file-type icon for plain files", async () => {
    const { contextChipIcon, contextChipPresentation, contextRecordFileName } =
      await import("./composerChipPresentation");
    expect(contextChipIcon(contextChipPresentation("terminal"), "")).toEqual({
      kind: "chip",
      name: "terminal",
    });
    const record = { kind: "file", path: "src/index.ts" };
    expect(
      contextChipIcon(contextChipPresentation("file", record), contextRecordFileName(record)),
    ).toEqual({ kind: "file", name: expect.any(String) });
    expect(contextRecordFileName({ name: "notes.txt" })).toBe("notes.txt");
    expect(contextRecordFileName(undefined)).toBe("");
  });
});
