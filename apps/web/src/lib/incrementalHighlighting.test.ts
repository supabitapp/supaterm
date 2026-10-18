import { toHtml } from "hast-util-to-html";
import { getSharedHighlighter } from "@pierre/diffs";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { createIncrementalHighlightedDocument } from "./incrementalHighlighting";

const samples = {
  typescript: "/* multi\nline comment */\nconst x = `template\n${1 + 2}`;\nconst re = /abc/;\n",
  python: '#!/usr/bin/python\nx = """multi\nline"""\nprint(x)\n',
  bash: "#!/bin/bash\ncat <<EOF\nhello\nEOF\necho hi\n",
  html: "<script>\nconst x = 1;\n</script>\n<style>\np {color:red;}\n</style>\n",
  markdown: "# heading\n\n```ts\nconst a = 1;\n```\n\ntext\n",
  rust: 'fn main() {\n let x = r#"multi\nline"#;\n}\n',
  tsx: 'const element = <div\n className="x">\n{value}\n</div>;\n',
  json: '{\n "value": [1,\n 2, 3]\n}\n',
  yaml: "key: |\n  multiline\n  value\nnext: true\n",
  css: '/* comment\n continued */\np::before {\n content: "text";\n}\n',
  sql: "SELECT 'multi\nline'\nFROM table_name;\n",
} as const;

const highlighterPromise = getSharedHighlighter({
  langs: Object.keys(samples) as Array<keyof typeof samples>,
  themes: ["pierre-dark", "pierre-light"],
  preferredHighlighter: "shiki-wasm",
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("incremental code highlighting", () => {
  it.each(Object.entries(samples))(
    "matches full HTML at every streaming prefix in %s",
    async (language, code) => {
      const highlighter = await highlighterPromise;
      for (const theme of ["pierre-dark", "pierre-light"] as const) {
        const highlight = createIncrementalHighlightedDocument(highlighter, language, theme);
        for (let end = 0; end <= code.length; end++) {
          const text = code.slice(0, end);
          expect(toHtml(highlight(text)), `${theme}, prefix ${end}`).toBe(
            highlighter.codeToHtml(text, { lang: language, theme }),
          );
        }
      }
    },
  );

  it("keeps completed lines while a newline-terminated last line grows", async () => {
    const highlighter = await highlighterPromise;
    const completed = "/* open\ncomment */\n";
    const current = "const current = `a\nb`;";
    const inputs = Array.from(
      { length: current.length + 1 },
      (_, end) => `${completed}${current.slice(0, end)}\n`,
    );
    const expected = inputs.map((text) =>
      highlighter.codeToHtml(text, { lang: "typescript", theme: "pierre-dark" }),
    );
    const highlight = createIncrementalHighlightedDocument(
      highlighter,
      "typescript",
      "pierre-dark",
    );
    expect(toHtml(highlight(inputs[0]!))).toBe(expected[0]);
    const codeToHast = vi.spyOn(highlighter, "codeToHast");
    expect(inputs.slice(1).map((text) => toHtml(highlight(text)))).toEqual(expected.slice(1));
    expect(codeToHast.mock.calls.every(([text]) => !text.includes("comment */"))).toBe(true);
  });

  it("resets after edits and truncation, including edits to a completed line", async () => {
    const highlighter = await highlighterPromise;
    const highlight = createIncrementalHighlightedDocument(
      highlighter,
      "typescript",
      "pierre-dark",
    );
    const inputs = [
      "/* open\ncomment\n",
      "/* open\ncomment\n*/\nconst x = 1;",
      "const edited = 2;\nconst x = 1;",
      "const edited = 2;\nconst x = 10;",
      "const edited = 2;\n",
      "",
      "\n\n\nconst fresh = true;\n",
    ];
    for (const text of inputs) {
      expect(toHtml(highlight(text))).toBe(
        highlighter.codeToHtml(text, { lang: "typescript", theme: "pierre-dark" }),
      );
    }
  });

  it.each(["text", "plaintext", "plain", "txt", "ansi"])(
    "preserves %s without requesting grammar state",
    async (language) => {
      const highlighter = await highlighterPromise;
      const highlight = createIncrementalHighlightedDocument(highlighter, language, "pierre-dark");
      for (const text of ["plain\ntext", "\u001b[31mred\ncontinued", "\n"]) {
        expect(toHtml(highlight(text))).toBe(
          highlighter.codeToHtml(text, { lang: language, theme: "pierre-dark" }),
        );
      }
    },
  );

  it("preserves partial CRLF and CR line endings", async () => {
    const highlighter = await highlighterPromise;
    const highlight = createIncrementalHighlightedDocument(
      highlighter,
      "typescript",
      "pierre-dark",
    );
    const code = "/* multi\r\nline */\r\nconst x = 1;\r\n";
    for (let end = 0; end <= code.length; end++) {
      const text = code.slice(0, end);
      expect(toHtml(highlight(text))).toBe(
        highlighter.codeToHtml(text, { lang: "typescript", theme: "pierre-dark" }),
      );
    }
  });
});
