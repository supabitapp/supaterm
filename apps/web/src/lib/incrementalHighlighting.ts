import {
  createHastElement,
  createTextNodeElement,
  renderTokenLines,
  type DiffsHighlighter,
  type DiffsStreamTokenizer,
  type ThemedToken,
} from "@pierre/diffs";

import type { DiffThemeName } from "./diffRendering";

export interface HighlightedDocument {
  type: "root";
  children: ReturnType<typeof createHastElement>[];
}

export interface IncrementalHighlightedDocument {
  (code: string): HighlightedDocument;
  dispose(): void;
}

function highlightedDocument(
  highlighter: DiffsHighlighter,
  themeName: DiffThemeName,
  children: ReturnType<typeof renderTokenLines>,
): HighlightedDocument {
  const theme = highlighter.getTheme(themeName);
  return {
    type: "root" as const,
    children: [
      createHastElement({
        tagName: "pre",
        properties: {
          class: "diffs",
          style: `color:${theme.fg};background-color:${theme.bg}`,
          tabIndex: 0,
        },
        children: [createHastElement({ tagName: "code", children })],
      }),
    ],
  };
}

export function highlightCodeDocument(
  highlighter: DiffsHighlighter,
  code: string,
  language: string,
  theme: DiffThemeName,
): HighlightedDocument {
  const { tokens } = highlighter.codeToTokens(code, { lang: language, theme });
  const children = renderTokenLines(tokens, { cacheHtmlStyles: true }).flatMap((line, index) =>
    index === 0 ? [line] : [createTextNodeElement("\n"), line],
  );
  return highlightedDocument(highlighter, theme, children);
}

export function createIncrementalHighlightedDocument(
  highlighter: DiffsHighlighter,
  language: string,
  theme: DiffThemeName,
): IncrementalHighlightedDocument {
  let stream: DiffsStreamTokenizer | undefined;
  let source = "";
  let completed: ReturnType<typeof renderTokenLines> = [];

  const dispose = () => {
    stream?.dispose();
    stream = undefined;
    source = "";
    completed = [];
  };

  const highlight = (code: string) => {
    if (
      language === "ansi" ||
      language === "markdown" ||
      language === "md" ||
      language === "mdx" ||
      code.includes("\r")
    ) {
      dispose();
      return highlightCodeDocument(highlighter, code, language, theme);
    }

    const input = code.endsWith("\n") ? code.slice(0, -1) : code;
    if (!input.startsWith(source)) dispose();
    stream ??= highlighter.createStreamTokenizer({ lang: language, theme });
    const result = stream.enqueue(input.slice(source.length));
    if (result instanceof Promise) {
      void result.catch(() => undefined);
      dispose();
      return highlightCodeDocument(highlighter, code, language, theme);
    }
    source = input;

    let line: ThemedToken[] = [];
    for (const token of result.stable) {
      if (token.content === "\n") {
        completed.push(...renderTokenLines([line], { cacheHtmlStyles: true }));
        completed.push(createTextNodeElement("\n"));
        line = [];
      } else {
        line.push(token);
      }
    }
    const tail = renderTokenLines([result.unstable], { cacheHtmlStyles: true });
    if (code.endsWith("\n")) {
      tail.push(createTextNodeElement("\n"), ...renderTokenLines([[]], {}));
    }
    return highlightedDocument(highlighter, theme, [...completed, ...tail]);
  };

  highlight.dispose = dispose;
  return highlight;
}
