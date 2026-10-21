import {
  canUseWASM,
  getSharedHighlighter,
  type DiffsHighlighter,
  type HighlighterTypes,
  type SupportedLanguages,
} from "@pierre/diffs";

import { resolveDiffThemeName } from "./diffRendering";

export const PREFERRED_HIGHLIGHTER: HighlighterTypes = canUseWASM() ? "highlights" : "shiki-wasm";

const highlighterPromiseCache = new Map<string, Promise<DiffsHighlighter>>();

export function getSyntaxHighlighterPromise(language: string): Promise<DiffsHighlighter> {
  const cached = highlighterPromiseCache.get(language);
  if (cached) return cached;

  const promise = getSharedHighlighter({
    themes: [resolveDiffThemeName("dark"), resolveDiffThemeName("light")],
    langs: [language as SupportedLanguages],
    preferredHighlighter: PREFERRED_HIGHLIGHTER,
  }).catch((error) => {
    if (language === "text") {
      highlighterPromiseCache.delete(language);
      throw error;
    }
    return getSyntaxHighlighterPromise("text");
  });
  highlighterPromiseCache.set(language, promise);
  return promise;
}
