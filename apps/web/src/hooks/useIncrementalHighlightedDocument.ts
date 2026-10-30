import type { DiffsHighlighter } from "@pierre/diffs";
import { useEffect, useState } from "react";

import type { DiffThemeName } from "../lib/diffRendering";
import { createIncrementalHighlightedDocument } from "../lib/incrementalHighlighting";

/** State keeps streamed updates from rebuilding the highlighter through the compiler's render cache. */
export function useIncrementalHighlightedDocument(
  enabled: boolean,
  highlighter: DiffsHighlighter,
  language: string,
  theme: DiffThemeName,
): ReturnType<typeof createIncrementalHighlightedDocument> | null {
  const create = () => ({
    enabled,
    highlighter,
    language,
    theme,
    highlight: enabled ? createIncrementalHighlightedDocument(highlighter, language, theme) : null,
  });
  const [current, setCurrent] = useState(create);
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- disposes the previous streaming highlighter when its inputs change or the consumer unmounts
  useEffect(() => () => current.highlight?.dispose(), [current]);
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
