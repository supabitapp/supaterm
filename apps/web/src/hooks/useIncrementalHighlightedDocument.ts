import type { DiffsHighlighter } from "@pierre/diffs";
import { useState } from "react";

import type { DiffThemeName } from "../lib/diffRendering";
import { createIncrementalHighlightedDocument } from "../lib/incrementalHighlighting";

/**
 * Created during render, the document would share a compiler scope with the call
 * that highlights through it, because that call counts as mutating it. Each streamed
 * delta would then build a new document and re-tokenize every completed line.
 * State keeps one document per highlighter, language and theme.
 */
export function useIncrementalHighlightedDocument(
  enabled: boolean,
  highlighter: DiffsHighlighter,
  language: string,
  theme: DiffThemeName,
) {
  const create = () => ({
    enabled,
    highlighter,
    language,
    theme,
    highlight: enabled ? createIncrementalHighlightedDocument(highlighter, language, theme) : null,
  });
  const [current, setCurrent] = useState(create);
  if (
    current.enabled !== enabled ||
    current.highlighter !== highlighter ||
    current.language !== language ||
    current.theme !== theme
  ) {
    const next = create();
    setCurrent(next);
    return next.highlight;
  }
  return current.highlight;
}
