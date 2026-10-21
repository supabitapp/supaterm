import { toHtml } from "hast-util-to-html";
import { disposeHighlighter, getSharedHighlighter, type DiffsHighlighter } from "@pierre/diffs";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import { createIncrementalHighlightedDocument } from "./incrementalHighlighting";

const samples = {
  typescript: "/* multi\nline comment */\nconst x = `template\n${1 + 2}`;\nconst re = /abc/;\n",
  python: '#!/usr/bin/python\nx = """multi\nline"""\nprint(x)\n',
  bash: "#!/bin/bash\ncat <<EOF\nhello\nEOF\necho hi\n",
  html: "<script>\nconst x = 1;\n</script>\n<style>\np {color:red;}\n</style>\n",
  markdown: "# heading\n\n```ts\nconst a = 1;\n```\n\ntext\n",
  mdx: "# heading\n\n<Component value={1} />\n",
  rust: 'fn main() {\n let x = r#"multi\nline"#;\n}\n',
  tsx: 'const element = <div\n className="x">\n{value}\n</div>;\n',
  json: '{\n "value": [1,\n 2, 3]\n}\n',
  yaml: "key: |\n  multiline\n  value\nnext: true\n",
  css: '/* comment\n continued */\np::before {\n content: "text";\n}\n',
  sql: "SELECT 'multi\nline'\nFROM table_name;\n",
} as const;

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(["highlights", "shiki-wasm"] as const)(
  "%s incremental code highlighting",
  (engine) => {
    let highlighter: DiffsHighlighter;
    beforeAll(async () => {
      highlighter = await getSharedHighlighter({
        langs: Object.keys(samples) as Array<keyof typeof samples>,
        themes: ["pierre-dark", "pierre-light"],
        preferredHighlighter: engine,
      });
    });
    afterAll(() => disposeHighlighter());
    it.each(Object.entries(samples))(
      "matches full HTML at every streaming prefix in %s",
      (language, code) => {
        for (const theme of ["pierre-dark", "pierre-light"] as const) {
          const highlight = createIncrementalHighlightedDocument(highlighter, language, theme);
          for (let end = 0; end <= code.length; end++) {
            const text = code.slice(0, end);
            expect(toHtml(highlight(text)), `${theme}, prefix ${end}`).toBe(
              highlighter.codeToHtml(text, { lang: language, theme }),
            );
          }
          highlight.dispose();
        }
      },
    );

    it("keeps completed lines while a newline-terminated last line grows", () => {
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
      const codeToTokens = vi.spyOn(highlighter, "codeToTokens");
      expect(inputs.slice(1).map((text) => toHtml(highlight(text)))).toEqual(expected.slice(1));
      if (engine === "highlights") expect(codeToTokens).not.toHaveBeenCalled();
      else expect(codeToTokens.mock.calls.every(([code]) => !code.includes("\n"))).toBe(true);
    });

    it("resets after edits and truncation, including edits to a completed line", () => {
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

    it("releases the tokenizer and rebuilds a disposed document", () => {
      const createTokenizer = vi.spyOn(highlighter, "createStreamTokenizer");
      const highlight = createIncrementalHighlightedDocument(
        highlighter,
        "typescript",
        "pierre-dark",
      );
      const code = samples.typescript;
      highlight(code);
      const tokenizer = createTokenizer.mock.results[0]!.value;
      const dispose = vi.spyOn(tokenizer, "dispose");
      highlight.dispose();
      highlight.dispose();
      expect(dispose).toHaveBeenCalledTimes(1);
      expect(toHtml(highlight(code))).toBe(
        highlighter.codeToHtml(code, { lang: "typescript", theme: "pierre-dark" }),
      );
      expect(createTokenizer).toHaveBeenCalledTimes(2);
      highlight.dispose();
    });

    it("preserves Unicode when a streamed chunk splits a surrogate pair", () => {
      const highlight = createIncrementalHighlightedDocument(
        highlighter,
        "typescript",
        "pierre-dark",
      );
      const code = 'const greeting = "café 🐈";\nconst 中文 = "é";\n';
      for (let end = 0; end <= code.length; end++) {
        const text = code.slice(0, end);
        expect(toHtml(highlight(text))).toBe(
          highlighter.codeToHtml(text, { lang: "typescript", theme: "pierre-dark" }),
        );
      }
      highlight.dispose();
    });

    it.each(["text", "plaintext", "plain", "txt", "ansi"])(
      "preserves %s through its text fallback",
      (language) => {
        const highlight = createIncrementalHighlightedDocument(
          highlighter,
          language,
          "pierre-dark",
        );
        for (const text of ["plain\ntext", "\u001b[31mred\ncontinued", "\n"]) {
          expect(toHtml(highlight(text))).toBe(
            highlighter.codeToHtml(text, { lang: language, theme: "pierre-dark" }),
          );
        }
      },
    );

    it.each(["markdown", "md", "mdx"])("preserves newline-sensitive %s markers", (language) => {
      const highlight = createIncrementalHighlightedDocument(highlighter, language, "pierre-dark");
      for (const marker of ["#", "##", "-", "*", "+", "1."]) {
        for (const text of [`${marker}\n`, `${marker} content\n`]) {
          expect(toHtml(highlight(text))).toBe(
            highlighter.codeToHtml(text, { lang: language, theme: "pierre-dark" }),
          );
        }
      }
      highlight.dispose();
    });

    it("preserves partial CRLF and CR line endings", () => {
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
  },
);
