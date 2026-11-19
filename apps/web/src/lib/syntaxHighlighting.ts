import "@supaterm/client-runtime/assembly-highlighting";
import {
  canUseWASM,
  getSharedHighlighter,
  setCustomExtension,
  type DiffsHighlighter,
  type HighlighterTypes,
  type SupportedLanguages,
} from "@pierre/diffs";

import { resolveDiffThemeName } from "./diffRendering";

setCustomExtension("luau", "lua");
setCustomExtension("xsl", "xml");
setCustomExtension("xslt", "xml");

export const PREFERRED_HIGHLIGHTER: HighlighterTypes = canUseWASM() ? "highlights" : "shiki-wasm";

const highlighterPromiseCache = new Map<string, Promise<DiffsHighlighter>>();

export function getSyntaxHighlighterPromise(language: string): Promise<DiffsHighlighter>;
export function getSyntaxHighlighterPromise(language: string) {
  const cached = highlighterPromiseCache.get(language);
  if (cached) return cached satisfies Promise<DiffsHighlighter>;

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
  return promise satisfies Promise<DiffsHighlighter>;
}
