import { unified, type Processor } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { isWindowsAbsolutePath } from "./path.ts";

interface DestinationToken {
  readonly start: { readonly offset?: number };
  readonly end: { readonly offset?: number };
}

interface DestinationCompileContext {
  readonly stack: ReadonlyArray<{ readonly type: string; url?: string }>;
  resume(): string;
  sliceSerialize(token: DestinationToken): string;
}

interface EscapeCompileContext {
  readonly stack: ReadonlyArray<{
    readonly type: string;
    children?: Array<{ type: string; value?: string }>;
  }>;
}

function keepWindowsPathEscape(this: EscapeCompileContext) {
  const text = this.stack.at(-1)?.children?.at(-1);
  if (text?.type !== "text" || text.value === undefined) return;
  const before = text.value.slice(0, -1);
  if (/(?:^|\W)[A-Za-z]:(?:[\\/]\S*)?$/.test(before)) {
    text.value = `${before}\\${text.value.slice(-1)}`;
  }
}

export function remarkKeepWindowsPathDestinations(
  this: Processor,
  capture?: (
    authored: string,
    token: DestinationToken,
    node: DestinationCompileContext["stack"][number],
  ) => void,
) {
  function keepDestination(this: DestinationCompileContext, token: DestinationToken) {
    const decoded = this.resume();
    const authored = this.sliceSerialize(token);
    const windowsPath = isWindowsAbsolutePath(authored);
    const preserve = windowsPath && !authored.includes("&");
    const node = this.stack.at(-1);
    if (node) {
      node.url = preserve ? authored : decoded;
      if (windowsPath) capture?.(authored, token, node);
    }
  }
  // oxlint-disable-next-line no-this-in-exported-function -- unified binds the processor when installing plugins.
  const data = this.data();
  (data.fromMarkdownExtensions ??= []).push({
    exit: {
      resourceDestinationString: keepDestination,
      definitionDestinationString: keepDestination,
      characterEscape: keepWindowsPathEscape,
    },
  });
}

const parser = unified().use(remarkParse).use(remarkGfm);

export function markdownWithAuthoredWindowsPaths(markdown: string): string {
  if (!/\](?:\(|:)[\s>]*<?(?:[A-Za-z]:[\\/]|\\\\)/.test(markdown)) return markdown;
  const edits: Array<{ start: number; end: number; content: string; node: object }> = [];
  const tree = parser()
    .use(remarkKeepWindowsPathDestinations, (authored, token, node) => {
      if (!authored.includes("\\") || /[<>]/.test(authored)) return;
      const start = token.start.offset;
      const end = token.end.offset;
      if (start === undefined || end === undefined) return;
      const escaped = authored.replace(/\\(?!&)/g, "\\\\");
      const angled = markdown[start - 1] === "<";
      edits.push({ start, end, content: angled ? escaped : `<${escaped}>`, node });
    })
    .parse(markdown);
  const retainedNodes = new Set<object>();
  const visit = (node: {
    readonly type: string;
    readonly children?: ReadonlyArray<{ readonly type: string }>;
  }) => {
    retainedNodes.add(node);
    node.children?.forEach(visit);
  };
  visit(tree);
  for (const edit of edits
    .filter((edit) => retainedNodes.has(edit.node))
    .sort((left, right) => right.start - left.start)) {
    markdown = markdown.slice(0, edit.start) + edit.content + markdown.slice(edit.end);
  }
  return markdown;
}

function keepWindowsProsePathEscape(this: EscapeCompileContext) {
  if (this.stack.at(-1)?.type !== "fragment") keepWindowsPathEscape.call(this);
}

export function remarkKeepWindowsProsePaths(this: Processor) {
  // oxlint-disable-next-line no-this-in-exported-function -- unified binds the processor when installing plugins.
  (this.data().fromMarkdownExtensions ??= []).push({
    exit: { characterEscape: keepWindowsProsePathEscape },
  });
}
