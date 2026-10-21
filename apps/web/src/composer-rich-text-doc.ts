import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { splitPromptIntoComposerSegments } from "~/composer-editor-mentions";
import {
  parseInlineMarkdown,
  MARK_NESTING_ORDER,
  MARK_TO_TIPTAP,
  type RichTextMark,
} from "~/composer-rich-text";
import { markdownMathRanges } from "@supaterm/shared/markdownMath";

export type SkillMeta = { label: string; description: string | null };

export const LIST_NODE_NAMES = new Set(["taskList", "bulletList", "orderedList"]);
export const LIST_ITEM_NODE_NAMES = new Set(["taskItem", "listItem"]);

export function codeBlockSource(
  node: ProseMirrorNode,
  followed: boolean,
): {
  open: string;
  content: string;
  close: string;
} {
  const attrs = node.attrs as Record<string, unknown>;
  let fence = typeof attrs.fence === "string" && attrs.fence ? attrs.fence : "```";
  const language = typeof attrs.language === "string" ? attrs.language : "";
  let close = typeof attrs.close === "string" ? attrs.close : "";
  const content = node.textContent;

  const longest = Math.max(
    0,
    ...content
      .split("\n")
      .filter((line) => isClosingFence(line, fence))
      .map((line) => /^[`~]+/.exec(line)![0].length),
  );
  if (longest > 0) {
    fence = fence[0]!.repeat(longest + 1);
    if (close) close = `\n${fence}`;
  }

  if (!close && followed) close = `\n${fence}`;
  return { open: `${fence}${language}${content ? "\n" : ""}`, content, close };
}

function randomNodeKey(): string {
  return `tiptap-${Math.random().toString(36).slice(2)}`;
}

interface TaskLinePrefix {
  indent: string;
  checked: boolean;
  markerSpace: string;
  contentSpace: string;
}

function parseTaskPrefix(head: string): { prefix: TaskLinePrefix; markerLength: number } | null {
  const match = head.match(/^([ \t]*)-([ \t]+)\[([ xX])\]([ \t]*)/);
  if (!match) return null;
  const after = head.slice(match[0].length);
  if (after.length > 0 && !match[4]) return null;
  return {
    prefix: {
      indent: match[1] ?? "",
      checked: (match[3] ?? " ").toLowerCase() === "x",
      markerSpace: match[2]!,
      contentSpace: match[4]!,
    },
    markerLength: match[0].length,
  };
}

export function parseOpeningFence(line: string): { fence: string; language: string } | null {
  const match = /^(`{3,}|~{3,})([^\n]*)$/.exec(line);
  if (!match) return null;
  const fence = match[1]!;
  const language = match[2]!;
  if (fence.startsWith("`") && language.includes("`")) return null;
  return { fence, language };
}

export function isClosingFence(line: string, fence: string): boolean {
  const match = /^(`{3,}|~{3,})[ \t]*\r?$/.exec(line);
  if (!match) return false;
  const run = match[1]!;
  return run[0] === fence[0] && run.length >= fence.length;
}

type ListLinePrefix =
  | ({ kind: "task" } & TaskLinePrefix)
  | { kind: "bullet" | "ordered"; indent: string; marker: string; space: string };

function parseListPrefix(line: string): { prefix: ListLinePrefix; markerLength: number } | null {
  const task = parseTaskPrefix(line);
  if (task) return { prefix: { kind: "task", ...task.prefix }, markerLength: task.markerLength };
  const ordered = /^([ \t]*)(\d+[.)])((?:[ \t]+)|$)/.exec(line);
  if (ordered) {
    return {
      prefix: { kind: "ordered", indent: ordered[1]!, marker: ordered[2]!, space: ordered[3]! },
      markerLength: ordered[0].length,
    };
  }
  const bullet = /^([ \t]*)([-*+])((?:[ \t]+)|$)/.exec(line);
  if (bullet) {
    return {
      prefix: { kind: "bullet", indent: bullet[1]!, marker: bullet[2]!, space: bullet[3]! },
      markerLength: bullet[0].length,
    };
  }
  return null;
}

function listKey(prefix: ListLinePrefix): string {
  if (prefix.kind === "task") return "task";
  if (prefix.kind === "ordered") return `ordered:${prefix.marker.slice(-1)}`;
  return `bullet:${prefix.marker}`;
}

type InlineJson = Record<string, unknown>;

interface DocLine {
  list: ListLinePrefix | null;
  inline: InlineJson[];
}

/** Null for a `$name` that is not one of the provider's skills: it stays editable text. */
function atomJsonForSegment(
  segment: Exclude<ReturnType<typeof splitPromptIntoComposerSegments>[number], { type: "text" }>,
  skillLabelFor: (name: string) => SkillMeta | null,
): InlineJson | null {
  if (segment.type === "mention") {
    return {
      type: "composer-mention",
      attrs: { path: segment.path, source: segment.source },
    };
  }
  if (segment.type === "skill") {
    const meta = skillLabelFor(segment.name);
    if (!meta) return null;
    return {
      type: "composer-skill",
      attrs: {
        skillName: segment.name,
        skillLabel: meta.label,
        skillDescription: meta.description,
      },
    };
  }
  if (segment.type === "citation") {
    return {
      type: "composer-citation",
      attrs: { citation: segment.citation, source: segment.source, citeKey: randomNodeKey() },
    };
  }
  return {
    type: "composer-context-reference",
    attrs: {
      kind: segment.kind,
      contextId: segment.contextId,
      label: segment.label,
      source: segment.source,
    },
  };
}

interface PendingItem {
  prefix: ListLinePrefix;
  content: InlineJson[];

  children: PendingList[];
}

interface PendingList {
  key: string;
  items: PendingItem[];
}

function listJson(list: PendingList): InlineJson {
  const first = list.items[0]!.prefix;
  const items = list.items.map((item) => {
    const content = [
      { type: "paragraph", content: item.content },
      ...item.children.map((child) => listJson(child)),
    ];
    if (item.prefix.kind === "task") {
      return {
        type: "taskItem",
        attrs: {
          checked: item.prefix.checked,
          indent: item.prefix.indent,
          markerSpace: item.prefix.markerSpace,
          contentSpace: item.prefix.contentSpace,
        },
        content,
      };
    }
    return {
      type: "listItem",
      attrs: { indent: item.prefix.indent, marker: item.prefix.marker, space: item.prefix.space },
      content,
    };
  });
  if (first.kind === "task") return { type: "taskList", content: items };
  if (first.kind === "ordered") {
    return {
      type: "orderedList",
      attrs: { start: Number.parseInt(first.marker, 10) || 1 },
      content: items,
    };
  }
  return { type: "bulletList", content: items };
}

function textJsonForSpan(text: string, marks: RichTextMark[]): Record<string, unknown> {
  const json: Record<string, unknown> = { type: "text", text };
  if (marks.length > 0) {
    json.marks = [...marks]
      .sort((a, b) => MARK_NESTING_ORDER.indexOf(a) - MARK_NESTING_ORDER.indexOf(b))
      .map((mark) => ({ type: MARK_TO_TIPTAP[mark] }));
  }
  return json;
}

/**
 * `literalLength` keeps that many leading characters as plain text, for a paste
 * that continues a path query: markers inside a path such as `src/__init__.py`
 * must reach file search unstyled.
 */
export function buildTiptapContent(
  value: string,
  skillLabelFor: (name: string) => SkillMeta | null,
  options?: { styling?: boolean; blocks?: boolean; literalText?: boolean; literalLength?: number },
): Record<string, unknown>[] {
  if (options?.literalText) {
    return value.split("\n").map((line) => ({
      type: "paragraph",
      ...(line ? { content: [{ type: "text", text: line }] } : {}),
    }));
  }
  const styling = options?.styling ?? true;

  const blockSyntax = styling && (options?.blocks ?? true);
  let sentinel = "\uFFFC";
  for (let codePoint = 0xe000; value.includes(sentinel); codePoint += 1) {
    sentinel = String.fromCodePoint(codePoint);
  }
  const atoms: InlineJson[] = [];

  const atomSources: string[] = [];
  const literal = value.slice(0, options?.literalLength ?? 0);
  const remainder = value.slice(literal.length);
  const formulas = markdownMathRanges(remainder);
  let offset = 0;
  const chunks: Array<{ text: string } | { source: string }> = [];
  for (const formula of formulas) {
    chunks.push({ text: remainder.slice(offset, formula.start) }, { source: formula.source });
    offset = formula.end;
  }
  chunks.push({ text: remainder.slice(offset) });
  // Math stays editable source. Shield its commands and Markdown-like markers
  // from styling and context-chip parsing, then restore ordinary text nodes.
  const text = chunks
    .map((chunk) => {
      if ("source" in chunk) {
        atoms.push(textJsonForSpan(chunk.source, []));
        atomSources.push(chunk.source);
        return sentinel;
      }
      return splitPromptIntoComposerSegments(chunk.text)
        .map((segment) => {
          if (segment.type === "text") return segment.text;
          const atom = atomJsonForSegment(segment, skillLabelFor);
          if (!atom) return segment.source;
          atoms.push(atom);
          atomSources.push(segment.source);
          return sentinel;
        })
        .join("");
    })
    .join("");
  let atomIndex = 0;
  const buildInline = (content: string): InlineJson[] => {
    const spans = styling ? parseInlineMarkdown(content) : [{ text: content, marks: [] }];
    const inline: InlineJson[] = [];
    for (const span of spans) {
      span.text.split(sentinel).forEach((piece, index) => {
        if (index > 0) {
          const atom = atoms[atomIndex++]!;
          inline.push({ ...atom, marks: textJsonForSpan("", span.marks).marks });
        }
        if (piece) inline.push(textJsonForSpan(piece, span.marks));
      });
    }
    return inline;
  };
  const buildDocLine = (line: string): DocLine => {
    const parsed = blockSyntax ? parseListPrefix(line) : null;
    const content = parsed ? line.slice(parsed.markerLength) : line;
    return { list: parsed?.prefix ?? null, inline: buildInline(content) };
  };

  const sourceLines = text.split("\n");
  const entries: (
    | { code: Record<string, unknown> }
    | { rule: string }
    | { heading: { level: number; space: string; inline: InlineJson[] } }
    | { quote: { prefix: string; inline: InlineJson[] } }
    | { line: DocLine }
  )[] = [];
  const restoreSources = (line: string) =>
    line.split(sentinel).reduce((joined, piece, index) => {
      if (index === 0) return piece;
      atomIndex += 1;
      return joined + atomSources[atomIndex - 1]! + piece;
    }, "");

  for (let index = 0; index < sourceLines.length; index += 1) {
    const line = sourceLines[index]!;
    if (index === 0 && literal) {
      entries.push({
        line: { list: null, inline: [textJsonForSpan(literal, []), ...buildInline(line)] },
      });
      continue;
    }
    const opening = blockSyntax ? parseOpeningFence(line) : null;
    if (!opening) {
      if (blockSyntax && /^([-*_])(?:[ \t]*\1){2,}[ \t]*\r?$/.test(line)) {
        entries.push({ rule: line });
        continue;
      }
      const heading = blockSyntax ? /^(#{1,6})([ \t]+)([^\n]*)$/.exec(line) : null;
      if (heading) {
        entries.push({
          heading: {
            level: heading[1]!.length,
            space: heading[2]!,
            inline: buildInline(heading[3]!),
          },
        });
        continue;
      }
      const quote = blockSyntax ? /^(>[ \t]*)([^\n]*)$/.exec(line) : null;
      if (quote) entries.push({ quote: { prefix: quote[1]!, inline: buildInline(quote[2]!) } });
      else entries.push({ line: buildDocLine(line) });
      continue;
    }

    const language = restoreSources(opening.language);
    const body: string[] = [];
    let cursor = index + 1;
    let close = "";
    while (cursor < sourceLines.length) {
      const candidate = sourceLines[cursor]!;
      if (isClosingFence(candidate, opening.fence)) {
        close = `\n${candidate}`;
        break;
      }
      body.push(restoreSources(candidate));
      cursor += 1;
    }

    const closed = cursor < sourceLines.length;
    const content = body.join("\n");
    entries.push({
      code: {
        type: "codeBlock",
        attrs: { language, fence: opening.fence, close },
        ...(content ? { content: [{ type: "text", text: content }] } : {}),
      },
    });
    index = closed ? cursor : sourceLines.length;
  }

  const blocks: Record<string, unknown>[] = [];
  let rootLists: PendingList[] = [];
  let stack: { indent: string; list: PendingList; container: PendingList[] }[] = [];
  const flushLists = () => {
    for (const list of rootLists) blocks.push(listJson(list));
    rootLists = [];
    stack = [];
  };
  const openList = (container: PendingList[], key: string): PendingList => {
    const list = { key, items: [] };
    container.push(list);
    return list;
  };
  let openQuote: { prefix: string; content: InlineJson[][] } | null = null;
  const flushQuote = () => {
    if (!openQuote) return;
    blocks.push({
      type: "blockquote",
      attrs: { prefix: openQuote.prefix },
      content: openQuote.content.map((inline) => ({ type: "paragraph", content: inline })),
    });
    openQuote = null;
  };
  for (const entry of entries) {
    if ("quote" in entry) {
      flushLists();
      if (openQuote && openQuote.prefix !== entry.quote.prefix) flushQuote();
      openQuote ??= { prefix: entry.quote.prefix, content: [] };
      openQuote.content.push(entry.quote.inline);
      continue;
    }
    flushQuote();
    if ("code" in entry) {
      flushLists();
      blocks.push(entry.code);
      continue;
    }
    if ("rule" in entry) {
      flushLists();
      blocks.push({ type: "horizontalRule", attrs: { source: entry.rule } });
      continue;
    }
    if ("heading" in entry) {
      flushLists();
      blocks.push({
        type: "heading",
        attrs: { level: entry.heading.level, space: entry.heading.space },
        content: entry.heading.inline,
      });
      continue;
    }
    const line = entry.line;
    if (!line.list) {
      flushLists();
      blocks.push({ type: "paragraph", content: line.inline });
      continue;
    }
    const item: PendingItem = { prefix: line.list, content: line.inline, children: [] };
    const key = listKey(line.list);
    const indent = line.list.indent;
    for (;;) {
      const top = stack[stack.length - 1];
      if (!top) {
        stack.push({ indent, list: openList(rootLists, key), container: rootLists });
        continue;
      }
      if (top.indent === indent) {
        if (top.list.key !== key) top.list = openList(top.container, key);
        top.list.items.push(item);
        break;
      }
      if (top.indent !== "" && !indent.startsWith(top.indent)) {
        if (stack.length > 1) {
          stack.pop();
          continue;
        }
        top.indent = indent;
        if (top.list.key !== key) top.list = openList(top.container, key);
        top.list.items.push(item);
        break;
      }
      const parent = top.list.items[top.list.items.length - 1];
      if (!parent) {
        top.list.items.push(item);
        break;
      }
      const list = openList(parent.children, key);
      stack.push({ indent, list, container: parent.children });
      list.items.push(item);
      break;
    }
  }
  flushQuote();
  flushLists();
  return blocks;
}

export function buildDocJson(
  value: string,
  skillLabelFor: (name: string) => SkillMeta | null,
  options?: { styling?: boolean; literalText?: boolean },
) {
  const content = buildTiptapContent(value, skillLabelFor, options);

  if (content.at(-1)?.type === "horizontalRule") content.push({ type: "paragraph" });
  return { type: "doc", content };
}
