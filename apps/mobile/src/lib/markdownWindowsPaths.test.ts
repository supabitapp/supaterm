import { describe, expect, it } from "vite-plus/test";
import {
  markdownWithAuthoredWindowsPaths,
  parseMarkdownDocument,
  type MarkdownNode,
} from "./markdownDocument";

function destinations(markdown: string) {
  const urls: string[] = [];
  const visit = (node: MarkdownNode) => {
    if (node.type === "link" || node.type === "image" || node.type === "definition") {
      urls.push(node.url);
    }
    if ("children" in node) node.children.forEach(visit);
  };
  visit(parseMarkdownDocument(markdown));
  return urls;
}

describe("Windows Markdown destinations", () => {
  it.each([
    ["[file](C:\\repo\\.github\\file.md)", "C:\\repo\\.github\\file.md"],
    ["[file](C:\\repo\\.github\\a(b).md)", "C:\\repo\\.github\\a(b).md"],
    ["[file][ref]\n\n[ref]: C:\\repo\\folder(name)\\_file.md", "C:\\repo\\folder(name)\\_file.md"],
    ["![image](C:\\repo\\_assets\\preview.png)", "C:\\repo\\_assets\\preview.png"],
    ["[file](<C:\\My Project\\.github\\file.md>)", "C:\\My Project\\.github\\file.md"],
    ["[file](\\\\server\\share\\.github\\file.md)", "\\\\server\\share\\.github\\file.md"],
    ["[file][ref]\n\n[ref]: C:\\repo\\.github\\file.md", "C:\\repo\\.github\\file.md"],
  ])("preserves the authored path through parsing: %s", (markdown, expected) => {
    expect(destinations(markdownWithAuthoredWindowsPaths(markdown))).toEqual([expected]);
  });

  it("preserves each destination independently", () => {
    const markdown =
      "[file](C:\\repo\\.github\\file.md)\n\n![image](D:\\repo\\_assets\\preview.png)";
    expect(destinations(markdownWithAuthoredWindowsPaths(markdown))).toEqual([
      "C:\\repo\\.github\\file.md",
      "D:\\repo\\_assets\\preview.png",
    ]);
  });

  it("leaves code examples and non-Windows links unchanged", () => {
    const tick = "`";
    const markdown = [
      tick + "[file](C:\\repo\\.github\\file.md)" + tick,
      tick.repeat(3) + "\n![image](C:\\repo\\.github\\image.png)\n" + tick.repeat(3),
      "[web](https://example.com/a\\_b)",
      "[relative](./a\\_b)",
    ].join("\n\n");
    expect(markdownWithAuthoredWindowsPaths(markdown)).toBe(markdown);
  });

  it("does not rewrite a path inside a link label", () => {
    const tick = "`";
    const label = tick + "[file](C:\\repo\\.github\\file.md)" + tick;
    const markdown = "[" + label + "](C:\\repo\\.github\\file.md)";
    const result = markdownWithAuthoredWindowsPaths(markdown);
    expect(result).toContain(label);
    expect(destinations(result)).toEqual(["C:\\repo\\.github\\file.md"]);
  });
  it("does not rewrite a destination-shaped image label", () => {
    const label = "[file](C:\\repo\\_a)";
    const markdown = `![${label}](C:\\repo\\_a)`;
    const result = markdownWithAuthoredWindowsPaths(markdown);
    expect(result).toContain(label);
    expect(destinations(result)).toEqual(["C:\\repo\\_a"]);
  });
});
