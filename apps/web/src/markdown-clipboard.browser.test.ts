import { describe, expect, it } from "vite-plus/test";

import { chatMarkdownClipboardPayload } from "./markdown-clipboard";

function selectionOf(range: Range): Selection {
  return { rangeCount: 1, getRangeAt: () => range } as unknown as Selection;
}

describe("chatMarkdownClipboardPayload", () => {
  it("copies a relabeled link's source when the selection stays inside its label", () => {
    const url = "https://github.com/acme/web/pull/681";
    const paragraph = document.createElement("p");
    paragraph.innerHTML = `See <a href="${url}" data-markdown-copy="${url}"><span>#681</span></a> now`;
    const label = paragraph.querySelector("span")!.firstChild!;
    const range = document.createRange();
    range.setStart(label, 0);
    range.setEnd(label, "#681".length);

    const payload = chatMarkdownClipboardPayload(selectionOf(range));

    expect(payload?.text).toBe(url);
    expect(payload?.html).toContain(`href="${url}"`);
  });
});
