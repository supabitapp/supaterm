import { describe, expect, it } from "vite-plus/test";

import { LARGE_MARKDOWN_CHUNK_MAX_CHARS, splitMarkdown } from "./markdownChunks.ts";

const splitLargeMarkdown = (text: string, targetChars?: number) =>
  splitMarkdown(text, targetChars).chunks;

const starts = (text: string) =>
  splitLargeMarkdown(text, 1).map((chunk) => chunk.text.split("\n")[0]);

describe("splitMarkdown", () => {
  it("cuts only where a new top-level block starts, and keeps every byte", () => {
    const text = [
      "# Title",
      "Intro paragraph",
      "",
      "- item one",
      "",
      "  continued item",
      "- item two",
      "",
      "2. ordered",
      "",
      "```md",
      "# not a heading",
      "",
      "Not a paragraph",
      "```",
      "",
      "> quote",
      "",
      "Closing paragraph",
      "## Next",
      "---",
      "",
      "| a | b |",
    ].join("\n");
    const chunks = splitLargeMarkdown(text, 1);
    expect(chunks.map((chunk) => chunk.text).join("\n")).toBe(text);
    expect(chunks.reduce((sum, chunk) => sum + chunk.lines, 0)).toBe(text.split("\n").length);
    expect(starts(text)).toEqual([
      "# Title",
      "```md",
      "> quote",
      "Closing paragraph",
      "## Next",
      "| a | b |",
    ]);
  });

  it("keeps a fence open until a matching closer", () => {
    const text = ["````", "```", "", "# inside", "````", "", "after"].join("\n");
    expect(starts(text)).toEqual(["````", "after"]);
  });

  it("keeps HTML blocks and display math open across blank lines", () => {
    const text = [
      "<!--",
      "",
      "# hidden",
      "-->",
      "",
      "$$",
      "",
      "Inside math",
      "$$",
      "",
      "<pre>",
      "",
      "Preformatted",
      "</pre>",
      "",
      "<!-- one line -->",
      "",
      "<div>",
      "# literal",
      "</div>",
      "",
      '<p class="lead">text',
      "# literal",
      "</p>",
      "",
      '<span class="box">',
      "# literal",
      "</span>",
      "",
      "<details>",
      "<summary>Answer</summary>",
      "",
      "Inside details",
      "",
      "</details>",
      "",
      "<table><tr><td>",
      "",
      "```ts",
      "inside a cell",
      "```",
      "",
      "</td></tr></table>",
      "",
      '<ol start="10">',
      "",
      "<li>one</li>",
      "",
      "<li>two</li>",
      "",
      "</ol>",
      "",
      "```html",
      "<details>",
      "```",
      "",
      "after",
    ].join("\n");
    expect(starts(text)).toEqual(["<!--", "```html", "after"]);
    const multiline = [
      "<details",
      '  class="faq"><!-- </details> -->',
      "",
      "Inside details",
      "",
      "</details>",
      "",
      "after",
    ].join("\n");
    expect(starts(multiline)).toEqual(["<details", "after"]);
    const unclosed = ["<details>", "", "x".repeat(32 * 1024), "", "after"].join("\n");
    expect(starts(unclosed)).toEqual(["<details>", "after"]);
    const head = ["<details>", "", "a".repeat(8 * 1024), "", ""].join("\n");
    const longLine = "x".repeat(LARGE_MARKDOWN_CHUNK_MAX_CHARS - head.length);
    expect(starts(head + longLine)).toEqual(["<details>"]);
    expect(starts(`${head}${longLine}x`)).toEqual(["<details>", `${longLine}x`]);
    expect(starts(`${head}\`\`\`json\n${longLine}\n\`\`\`\n\n</details>`)).toEqual([
      "<details>",
      "```json",
    ]);
  });

  it("treats an autolink or inline HTML line as a paragraph, so a following fence still opens", () => {
    const text = [
      "<https://example.com>",
      "```md",
      "",
      "# literal",
      "```",
      "",
      "<b>bold</b> text",
      "```md",
      "",
      "# literal",
      "```",
      "",
      "after",
    ].join("\n");
    expect(starts(text)).toEqual(["<https://example.com>", "after"]);
  });

  it("keeps the complete sample fence before a later oversized source chunk", () => {
    const example = ["```md", "Sample Markdown", "", "# Sample heading", "```"].join("\n");
    const preview = ["x".repeat(4200), "<span>", example, "More prose", "<span>"].join("\n");
    const oversized = "# Appendix\n" + "[link](/example) ".repeat(11_000);
    const { chunks } = splitMarkdown(preview + "\n" + oversized);
    expect(chunks.map((chunk) => chunk.text)).toEqual([preview, oversized]);
  });

  it.each(["===", "---", "***"])(
    "keeps HTML together after a long paragraph and %s",
    (boundary) => {
      const text = ["x".repeat(9000), boundary, "<span>", "# literal"].join("\n");
      expect(splitMarkdown(text).chunks.map((chunk) => chunk.text)).toEqual([text]);
    },
  );

  it.each([
    ["a fence", "```md", "```"],
    ["an HTML comment", "<!--", "-->"],
    ["display math", "$$", "$$"],
  ])("keeps %s intact after an ambiguous standalone tag", (_, open, close) => {
    const block = [open, "Sample Markdown", "", "# Sample heading", close].join("\n");
    const preview = ["x".repeat(9000), "<span>", block].join("\n");
    expect(splitMarkdown(preview).chunks.map((chunk) => chunk.text)).toEqual([preview]);
  });

  it("preserves an oversized ambiguous region for source display", () => {
    const oversized = ["x".repeat(LARGE_MARKDOWN_CHUNK_MAX_CHARS), "<span>", "# Heading"].join(
      "\n",
    );
    const next = "# Next";
    const text = oversized + "\n\n" + next;
    expect(splitMarkdown(text).chunks.map((chunk) => chunk.text)).toEqual([oversized + "\n", next]);
  });

  it.each([
    ["multiline math with backticks", ["$$", "```", "$$", " # Heading"]],
    ["single-line display math", ["$$x$$"]],
  ])("keeps standalone HTML intact after %s", (_, math) => {
    const text = ["x".repeat(4200), "<span>", ...math, "<span>", "# literal"].join("\n");
    expect(splitMarkdown(text).chunks.map((chunk) => chunk.text)).toEqual([text]);
  });

  it("can cut at a heading after a tag in a lazy quote continuation", () => {
    const quote = ["> " + "x".repeat(4200), "continued", "<span>"].join("\n");
    const heading = "# Next";
    expect(splitMarkdown(quote + "\n" + heading).chunks.map((chunk) => chunk.text)).toEqual([
      quote,
      heading,
    ]);
  });

  it("waits for the target size before cutting", () => {
    const text = ["# a", "", "b", "", "# c", "", "d"].join("\n");
    expect(splitLargeMarkdown(text, 6).map((chunk) => chunk.text)).toEqual([
      "# a\n\nb\n",
      "# c\n\nd",
    ]);
  });

  it("keeps leading frontmatter in the first piece", () => {
    const text = ["---", "title: x", "", "# not a heading", "---", "", "# Heading"].join("\n");
    expect(starts(text)).toEqual(["---", "# Heading"]);
  });

  it.each([
    ["one space", " # References"],
    ["two spaces", "  ### References"],
    ["three spaces", "   ###### References"],
  ])("collects definitions after headings indented by %s without cutting there", (_, heading) => {
    const intro = "[Release notes][release]\n";
    const definition = "[release]: /releases";
    const appendix = ["## Appendix", heading, definition].join("\n");
    const result = splitMarkdown(`${intro}\n${appendix}`, 1);

    expect(result.definitions).toBe(definition);
    expect(result.chunks.map((chunk) => chunk.text)).toEqual([intro, appendix]);
  });

  it.each([
    ["an ordered item whose content starts farther right", "10. Item\n\n", ""],
    ["an item padded to the next tab stop", "-\tItem\n\n", ""],
    ["a blockquote that ends the list", "- Item\n> quote\n", ""],
    ["an HTML comment that ends the list", "- Item\n<!-- note -->\n", ""],
    ["an HTML block that ends the list", "- Item\n<div>top level</div>\n\n", ""],
    ["a math block that ends the list", "- Item\n$$\nx\n$$\n", ""],
    ["an indented thematic break", "  - - -\n", ""],
    ["an empty list item", "-\n\n", "  "],
    ["an empty list item with trailing spaces", "-  \n\n", "  "],
    ["an empty list item followed by dedented prose", "-\nfoo\n", "  "],
  ])("collects definitions after a fence following %s", (_, beforeFence, definitionIndent) => {
    const definition = "[ref]: /target";
    const text = beforeFence + "  ```sh\n  example\n  ```\n" + definitionIndent + definition;
    expect(splitMarkdown(text).definitions).toBe(definition);
  });

  it.each([
    ["nested markers on one line", "- - ```\n    code\n    ```"],
    ["a line of many nested markers", "- ".repeat(70_000) + "x"],
    ["a heading in a list item", "- # Heading\n  2. Item\n     ```\n     code\n        ```"],
    ["a lazy ordered marker", "- outer\n  - inner\n2. lazy\n    ```\n       ```"],
  ])("collects a list item definition after %s", (_, list) => {
    const definition = "[ref]: /target";
    expect(splitMarkdown(`${list}\n\n  ${definition}`).definitions).toBe(definition);
  });

  it.each([
    ["after a list fence", ["- Item", "  ```", "  code", "```", "[ref]: /fake", "```"]],
    ["after a paragraph", ["Paragraph", "2. continuation", "   ```", "[ref]: /fake", "   ```"]],
    [
      "in a parent item after a nested item",
      ["- outer", "  - inner", "    ```", "  ```", "  [ref]: /fake", "  ```"],
    ],
  ])("keeps definitions inside a top-level fence %s literal", (_, lines) => {
    expect(splitMarkdown(lines.join("\n")).definitions).toBe("");
  });

  it.each(["", " ", "  ", "   "])(
    "collects link definitions outside code with fence indent %j",
    (indent) => {
      const text = [
        "[![badge][b]][site]",
        "",
        "```md",
        "[fake]: /not-a-definition",
        "```",
        "",
        "Paragraph",
        "[inline]: /continues-the-paragraph",
        "",
        "[site]: https://example.com",
        "[b]: https://example.com/badge.svg 'Badge'",
        "[^note]: a footnote",
        "",
        '[x]: /url "title" is paragraph text',
        "",
        "# Heading",
        "[h]: /after-heading",
        "",
        "---",
        "[t]: /after-break",
        "",
        "===",
        "[p]: /paragraph-text",
        "",
        `${indent}\`\`\`sh`,
        "npm install",
        `${indent}\`\`\``,
        "[fence]: /after-fence",
        "~~~",
        "~~~",
        "Text after a fence",
        "[q]: /continues-the-paragraph",
        "",
        "$$",
        "x",
        "$$ trailing",
        "[math]: /inside-math",
        "",
        "<!-->",
        "```",
        "-->",
        "```",
        "[comment]: /after-a-closed-comment",
        "```",
        "[code]: /inside-a-fence-after-a-comment",
        "```",
        "",
        "- ```md",
        "  ~~~",
        "  ~~~",
        "  [list]: /inside-a-list-fence",
        "  ```",
      ].join("\n");
      expect(splitMarkdown(text).definitions).toBe(
        "[site]: https://example.com\n[b]: https://example.com/badge.svg 'Badge'\n[h]: /after-heading\n[t]: /after-break\n[fence]: /after-fence\n[comment]: /after-a-closed-comment",
      );
    },
  );
});
