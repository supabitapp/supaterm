import { describe, expect, it } from "vite-plus/test";

import { COMPOSER_CONTEXT_CLIPBOARD_MIME } from "@supaterm/shared/composerContextClipboard";

import { clipboardItemFlavors } from "./useCopyToClipboard";

describe("clipboardItemFlavors", () => {
  it("reserves plain text even when an extra flavor attempts to replace it", () => {
    const flavors = clipboardItemFlavors("original", {
      "text/plain": "replacement",
      "text/html": "<b>original</b>",
    });
    expect(flavors["text/plain"]).toBe("original");
    expect(flavors["text/html"]).toBe("<b>original</b>");
  });

  it("keeps caller-built rich HTML when attaching a context fragment", () => {
    const fragment = JSON.stringify({ version: 1, source: {}, records: [] });
    const rich = "<p><strong>Message</strong></p>";

    const html = clipboardItemFlavors("Message", {
      [COMPOSER_CONTEXT_CLIPBOARD_MIME]: fragment,
      "text/html": rich,
    })["text/html"];
    expect(html).toContain(rich);
    expect(html).toContain("data-supaterm-context-fragment=");
  });
});
