import { getFiletypeFromFileName } from "@pierre/diffs";
import { expect, it } from "vite-plus/test";

import { getSyntaxHighlighterPromise } from "./syntaxHighlighting";
import { resolveDiffThemeName } from "./diffRendering";

it.each([
  "asm",
  "assembly",
  "s",
  ...["asm", "ASM", "s", "S", "nasm", "NASM"].map((ext) => `src/start.${ext}`),
])("highlights assembly in %s", async (hint) => {
  const language = hint.includes("/") ? getFiletypeFromFileName(hint) : hint;
  const highlighter = await getSyntaxHighlighterPromise(language);
  const code = "mov eax, 42 ; answer\nret";
  for (const theme of (["light", "dark"] as const).map(resolveDiffThemeName)) {
    const { tokens } = highlighter.codeToTokens(code, { lang: language, theme });
    expect(tokens.map((line) => line.map((token) => token.content).join("")).join("\n")).toBe(code);
    expect(new Set(tokens.flat().map((token) => token.color)).size).toBeGreaterThan(1);
  }
});
