import { expect, it } from "vite-plus/test";
import { markdownDestinationHostPath } from "./markdownLinks.ts";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { markdownWithAuthoredWindowsPaths } from "./markdownWindowsPaths.ts";
import {
  chatMarkdownImageSources,
  CHAT_MARKDOWN_REHYPE_PLUGINS,
  CHAT_MARKDOWN_REMARK_PLUGINS,
} from "./markdownPipeline.ts";

it.each([
  [String.raw`![paren](C:\a\)b.png)`, String.raw`C:\a\)b.png`],
  [String.raw`![paren](<C:\a\)b.png>)`, String.raw`C:\a\)b.png`],
  [String.raw`![amp](C:\R&D\.supaterm\a&amp;b.png)`, String.raw`C:\R&D\.supaterm\a&b.png`],
  [String.raw`![html](<C:\R\&D\.supaterm\b.png>)`, String.raw`C:\R&D\.supaterm\b.png`],
  [
    String.raw`![ref][image]

[image]: C:\R&D\.supaterm\a&amp;b.png`,
    String.raw`C:\R&D\.supaterm\a&b.png`,
  ],
  ["> ![quoted](\n> C:\\work\\.supaterm\\shot.png)", String.raw`C:\work\.supaterm\shot.png`],
])("preserves Windows destinations for native Markdown parsing: %s", (markdown, expected) => {
  const processor = unified().use(remarkParse);
  const tree = processor.parse(markdownWithAuthoredWindowsPaths(markdown));
  const urls: string[] = [];
  type Node = { type: string; url?: string; children?: ReadonlyArray<Node> };
  const visit = (node: Node) => {
    if (node.url !== undefined) urls.push(node.url);
    node.children?.forEach(visit);
  };
  visit(tree);
  expect(urls).toEqual([expected]);
});

it("only rewrites Windows destinations retained in the parsed Markdown", () => {
  const examples = [
    "`[file](C:\\repo\\.config\\file.md)`",
    "```md\n![image](C:\\repo\\.config\\image.png)\n```",
    String.raw`[web](https://example.com/a\_b?key=&amp;)`,
    String.raw`[relative](./a\_b)`,
  ].join("\n\n");
  expect(markdownWithAuthoredWindowsPaths(examples)).toBe(examples);

  const label = String.raw`[file](C:\repo\_a)`;
  const markdown = `![${label}](C:\\repo\\_a)`;
  const rewritten = markdownWithAuthoredWindowsPaths(markdown);
  expect(rewritten).toContain(`![${label}]`);
  expect(unified().use(remarkParse).parse(rewritten).children[0]).toMatchObject({
    children: [{ type: "image", url: String.raw`C:\repo\_a` }],
  });
});

it("preserves in-app thread links through the shared Markdown sanitizer", () => {
  const processor = unified()
    .use(remarkParse)
    .use(CHAT_MARKDOWN_REMARK_PLUGINS)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(CHAT_MARKDOWN_REHYPE_PLUGINS);
  const tree = processor.runSync(
    processor.parse(
      '[Open thread](supaterm-thread://v1/thread)\n\n<supaterm-thread://v2/environment/thread:a%3A1>\n\n<a href="javascript:alert(1)">Unsafe</a>',
    ),
  );
  expect(tree.children[0]).toMatchObject({
    tagName: "p",
    children: [
      {
        tagName: "a",
        properties: { href: "supaterm-thread://v1/thread" },
        children: [{ type: "text", value: "Open thread" }],
      },
    ],
  });
  expect(tree.children[2]).toMatchObject({
    tagName: "p",
    children: [
      {
        tagName: "a",
        properties: { href: "supaterm-thread://v2/environment/thread:a%3A1" },
        children: [{ type: "text", value: "supaterm-thread://v2/environment/thread:a%3A1" }],
      },
    ],
  });
  expect(JSON.stringify(tree)).not.toContain("javascript:");
});

it("keeps backslashes that CommonMark would read as escapes in prose Windows paths", () => {
  const processor = unified()
    .use(remarkParse)
    .use(CHAT_MARKDOWN_REMARK_PLUGINS)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(CHAT_MARKDOWN_REHYPE_PLUGINS);
  type Node = { type: string; value?: string; tagName?: string; children?: Node[] };
  const text = (node: Node): string =>
    node.type === "text"
      ? (node.value ?? "")
      : node.tagName === "code"
        ? `<code>${(node.children ?? []).map(text).join("")}</code>`
        : (node.children ?? []).map(text).join("");
  const render = (markdown: string) => text(processor.runSync(processor.parse(markdown)) as Node);

  expect(
    render(
      String.raw`Saved to C:\Users\me\.supaterm\_build and (C:\.scratch) and C:/work\.config.`,
    ),
  ).toBe(String.raw`Saved to C:\Users\me\.supaterm\_build and (C:\.scratch) and C:/work\.config.`);

  expect(render(String.raw`Escaped C:\\Users\\me`)).toBe(String.raw`Escaped C:\\Users\\me`);
  expect(render(String.raw`See C:\x and \*this\* and Note:\*that\*.`)).toBe(
    String.raw`See C:\x and *this* and Note:*that*.`,
  );
  expect(render(String.raw`${"`"}C:\me\.supaterm${"`"} and C:\me\.supaterm`)).toBe(
    String.raw`<code>C:\me\.supaterm</code> and C:\me\.supaterm`,
  );
});

it("keeps an image on its own line under a label but leaves inline images inline", () => {
  const processor = unified()
    .use(remarkParse)
    .use(CHAT_MARKDOWN_REMARK_PLUGINS)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(CHAT_MARKDOWN_REHYPE_PLUGINS);
  type Node = { type: string; value?: string; tagName?: string; children?: Node[] };
  const shape = (node: Node): string =>
    node.type === "text"
      ? (node.value ?? "")
      : node.tagName === "br" || node.tagName === "img"
        ? `<${node.tagName}>`
        : (node.children ?? []).map(shape).join("");
  const render = (markdown: string) => shape(processor.runSync(processor.parse(markdown)) as Node);

  expect(
    render("**Palette**\n![Palette](/tmp/palette.png)\n**Hero** (dark)\n![Hero](/tmp/hero.png)"),
  ).toBe("Palette<br>\n<img><br>\nHero (dark)<br>\n<img>");
  expect(render("Built [![CI](/ci.svg)](/ci)\nand wrapped")).toBe("Built <img>\nand wrapped");
  expect(render("Hard-wrapped\nprose")).toBe("Hard-wrapped\nprose");
});

it("finds rendered images without granting code, comments, or ordinary links", () => {
  expect(
    chatMarkdownImageSources(
      [
        "![plot](./plots/result.png)",
        '<img src="/tmp/chart.png">',
        "`![hidden](/tmp/code.png)`",
        "<!-- ![hidden](/tmp/comment.png) -->",
        "[ordinary](/tmp/link.png)",
        "![reference][plot]",
        "[plot]: /tmp/ref.png",
      ].join("\n\n"),
    ),
  ).toEqual(["./plots/result.png", "/tmp/chart.png", "/tmp/ref.png"]);
  expect(
    chatMarkdownImageSources(String.raw`![shot](C:\Users\me\.supaterm\shot.png)`).map(
      markdownDestinationHostPath,
    ),
  ).toEqual([String.raw`C:\Users\me\.supaterm\shot.png`]);
});
