import { describe, expect, it } from "vite-plus/test";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { Root, RootContent } from "mdast";
import { ENRICHED_INLINE_FILE_LINK_REGEX } from "./enrichedLinkPresentation";
import {
  markdownForNativeRendering,
  markdownWithInlineFileLinks,
  markdownWithHtml,
} from "./markdownDocument";

const rewrite = (markdown: string) =>
  markdownWithInlineFileLinks(markdown, ENRICHED_INLINE_FILE_LINK_REGEX);

describe("inline code that names a file", () => {
  it.each([
    [
      "file links",
      "See `src/math.ts:2`, `C:\\repo\\a.ts`, `./src/a&copy;.ts`, and [`./README.md`](readme).",
    ],
    [
      "tables",
      "Intro `src/math.ts:2`\n| `./README.md` | Fit |\n|---|---|\n| `./a.ts` | A |\n\nMore\n| a |\n|---|\n| b |",
    ],
    ["escaped pipe in file header", "Intro text\n| `./a\\|b.ts` | c |\n|---|---|\n| a | b |"],
    ["escaped pipe in file body", "Intro text\n| a | c |\n|---|---|\n| `./a\\|b.ts` | b |"],
    [
      "escaped pipe after a normal file span",
      "Intro `./normal.ts`\n| `./a\\|b.ts` | c |\n|---|---|\n| a | b |",
    ],
    [
      "unmatched delimiter before escaped pipe in header",
      "Intro `./normal.ts`\n| `x``./a\\|b.ts`` | c |\n|---|---|\n|a|b|",
    ],
    [
      "unmatched delimiter before escaped pipe in body",
      "Intro `./normal.ts`\n| a | c |\n|---|---|\n| `x``./a\\|b.ts`` | b |",
    ],
    ["tabbed quote header", ">\tIntro `./a.ts`\n>\t| `./b.ts` | c |\n>\t|---|---|\n>\t| a | b |"],
    ["lazy quote header", "> Intro\n`./README.md` | file\n> | - | - |\n> | ok | yes |"],
    ["lazy list header", "- Intro\n`./README.md` | file\n  | - | - |\n  | ok | yes |"],
    [
      "HTML",
      '<details>\n<summary>Files</summary>\n\nSee `src/math.ts:2`\n| `./README.md` |\n|---|\n| ok |\n<img alt="A &amp; B" src="https://example.com/a.png?a=1&amp;b=2">\n</details>',
    ],
    [
      "nested fences",
      '> - Example\n>   ````md\n>   ```ts\n>   `src/math.ts:2`\n>   <img src="literal.png">\n>   | a |\n>   |---|\n>   ```\n>   ````\n\nSee `./README.md`.',
    ],
    [
      "HTML fences",
      '<details>\n<summary>Example</summary>\n\n````md\n```html\n<img src="literal.png">\n```\n`src/math.ts`\n````\n\nSee `./README.md`\n</details>',
    ],
  ])("preserves the two-pass output for every streamed prefix: %s", (_name, fixture) => {
    for (const ending of ["\n", "\r\n", "\r"]) {
      const document = fixture.replaceAll("\n", ending);
      for (let length = 0; length <= document.length; length++) {
        const prefix = document.slice(0, length);
        const expected = previousTableBreaks(
          previousFileLinks(markdownWithHtml(prefix), ENRICHED_INLINE_FILE_LINK_REGEX),
        );
        expect(
          markdownForNativeRendering(prefix, ENRICHED_INLINE_FILE_LINK_REGEX),
          JSON.stringify(prefix),
        ).toBe(expected);
      }
    }
  });

  it("becomes a link to the same path", () => {
    expect(rewrite("See `src/math.ts:2` and `./README.md`.")).toBe(
      "See [src/math.ts:2](<src/math.ts:2>) and [./README.md](<./README.md>).",
    );
  });

  it("keeps commands, identifiers and URLs as code", () => {
    const markdown = "Run `vp test run`, call `useMemo`, open `https://example.com/a.ts`.";
    expect(rewrite(markdown)).toBe(markdown);
  });

  it("leaves fenced code blocks and code already inside a link alone", () => {
    const markdown = "```\nsrc/math.ts:2\n```\n\n[`src/math.ts`](src/math.ts)";
    expect(rewrite(markdown)).toBe(markdown);
  });

  it("links to the exact path when it holds backslashes or ampersands", () => {
    for (const path of ["C:\\repo\\_private\\file.ts", "./src/a&copy;.ts", "./src/[id].ts"]) {
      const paragraph = parser.parse(rewrite(`\`${path}\``)).children[0];
      const link = paragraph?.type === "paragraph" ? paragraph.children[0] : undefined;
      expect(link?.type === "link" && link.url).toBe(path);
      expect(
        link?.type === "link" && link.children[0]?.type === "text" && link.children[0].value,
      ).toBe(path);
    }
  });
});

const parser = unified().use(remarkParse).use(remarkGfm);
type MarkdownNode = Root | RootContent;
const INLINE_CODE_SPAN = /`+([^`\r\n]+)`+/g;

function previousFileLinks(markdown: string, fileLink: RegExp): string {
  if (![...markdown.matchAll(INLINE_CODE_SPAN)].some(([, code]) => fileLink.test(code!.trim())))
    return markdown;
  const edits: Array<{ start: number; end: number; content: string }> = [];
  const visit = (node: MarkdownNode) => {
    if (node.type === "inlineCode") {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      const escaped = node.value.replace(/[\\[\]&]/g, "\\$&");
      if (
        start !== undefined &&
        end !== undefined &&
        fileLink.test(node.value) &&
        !/[<>]/.test(node.value)
      )
        edits.push({
          start,
          end,
          content: `[${escaped}](<${escaped}>)`,
        });
    } else if (node.type !== "link" && node.type !== "linkReference" && "children" in node)
      node.children.forEach(visit);
  };
  visit(parser.parse(markdown));
  for (const edit of edits.toReversed())
    markdown = markdown.slice(0, edit.start) + edit.content + markdown.slice(edit.end);
  return markdown;
}

function isTableDelimiterRow(line: string): boolean {
  if (!line.includes("-")) return false;
  const row = line.replace(/^[ \t>]+/, "").trim();
  return row
    .replace(/^\||\|$/g, "")
    .split("|")
    .every((cell) => /^:?-+:?$/.test(cell.trim()));
}

function mayHaveTableUnderText(markdown: string): boolean {
  if (!markdown.includes("|")) return false;
  const lines = markdown.split(/\r\n|\r|\n/);
  for (let index = 2; index < lines.length; index += 1) {
    if (isTableDelimiterRow(lines[index]!) && /[^\s>]/.test(lines[index - 2]!)) return true;
  }
  return false;
}

function previousTableBreaks(markdown: string): string {
  if (!mayHaveTableUnderText(markdown)) return markdown;
  const lineStarts: number[] = [];
  const visit = (node: MarkdownNode) => {
    if (!("children" in node)) return;
    node.children.forEach((child, index) => {
      const previous = node.children[index - 1];
      const start = child.position?.start;
      if (
        child.type === "table" &&
        previous?.type === "paragraph" &&
        start?.offset !== undefined &&
        previous.position?.end.line === start.line - 1
      )
        lineStarts.push(
          Math.max(
            markdown.lastIndexOf("\n", start.offset - 1),
            markdown.lastIndexOf("\r", start.offset - 1),
          ) + 1,
        );
      visit(child);
    });
  };
  visit(parser.parse(markdown));
  for (const lineStart of lineStarts.toReversed()) {
    const [, header = "", cells = "", ending = "\n", markers = ""] =
      /^([ \t>]*)([^\r\n]*)(\r\n|\r|\n)([ \t>]*)/.exec(markdown.slice(lineStart)) ?? [];
    markdown =
      markdown.slice(0, lineStart) +
      `${markers.trimEnd()}${ending}${markers}${cells}` +
      markdown.slice(lineStart + header.length + cells.length);
  }
  return markdown;
}
