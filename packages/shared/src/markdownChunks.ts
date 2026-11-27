import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

// About one screen of rendered Markdown; parsing costs up to ~40 ms per KB with tables and math.
const CHUNK_TARGET_CHARS = 4 * 1024;
// A chunk past this (one huge fence or HTML block) is too slow to parse at once; show source.
export const LARGE_MARKDOWN_CHUNK_MAX_CHARS = 128 * 1024;
// A backtick fence's info string cannot contain a backtick, so "```a``` is inline" is a code span.
const FENCE_OPEN = /^ {0,3}(`{3,}(?![^`\n]*`)|~{3,})/;
const ATX_HEADING = /^ {0,3}#{1,6}(?:[ \t]|\r?$)/;
// A thematic break, or a "---" setext underline; no paragraph stays open after either. A lone
// "===" is paragraph text unless it underlines one, so it is left out.
const THEMATIC_BREAK = /^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})\r?$/;
// A column-0 paragraph, quote or table after a blank line closes any open list, quote or table.
const BLOCK_START = /^[\p{L}\p{N}`[!|>]/u;
const ORDERED_ITEM = /^\d{1,9}[.)](?:[ \t]|\r?$)/;
// CommonMark HTML blocks of types 1-5 and display math run past blank lines until their closer.
const SPANNING_BLOCKS: ReadonlyArray<readonly [open: RegExp, close: RegExp]> = [
  [/^ {0,3}<(?:script|pre|style|textarea)(?=[\s>]|$)/i, /<\/(?:script|pre|style|textarea)>/i],
  [/^ {0,3}<!--/, /-->/],
  [/^ {0,3}<\?/, /\?>/],
  [/^ {0,3}<!\[CDATA\[/, /\]\]>/],
  [/^ {0,3}<![A-Za-z]/, />/],
  [/^ {0,3}\$\$/, /\$\$/],
];

// CommonMark type-6 block tags start an HTML block even with trailing text or across lines.
const HTML_BLOCK_TAG =
  /^ {0,3}<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?=[ \t>]|\/>|\r?$)/i;
// CommonMark type-7 HTML blocks require a complete standalone open or closing tag on the line.
const HTML_STANDALONE_TAG =
  /^ {0,3}(?:<[A-Za-z][A-Za-z0-9-]*(?:[ \t]+[A-Za-z_:][A-Za-z0-9_.:-]*(?:[ \t]*=[ \t]*(?:[^ \t\r"'=<>`]+|'[^']*'|"[^"]*"))?)*[ \t]*\/?>|<\/[A-Za-z][A-Za-z0-9-]*[ \t]*>)[ \t]*\r?$/;
const closesAtBlankLine = (next: string) => next.trim() === "";
const flowParser = unified().use(remarkParse).use(remarkGfm).freeze();
const HTML_FLOW_MAX_CHARS = 8 * 1024;
// Parsing is far slower than the line scan, so a whole document shares one budget.
const HTML_PARSE_BUDGET_CHARS = 16 * 1024;

// A <details> or <table> wraps the Markdown between its tags, across the blank lines that end
// each HTML block, so a cut waits until the ones an HTML block opened are closed.
const WRAPPER_TAG = /<(\/?)(?:details|table)(?=[\s/>]|$)/gi;
// An end tag that never comes, or back-to-back wrappers, must not make one huge piece.
const WRAPPED_MAX_CHARS = 32 * 1024;

function withoutComments(line: string): string {
  let kept = "";
  let at = 0;
  for (let open = line.indexOf("<!--"); open !== -1; open = line.indexOf("<!--", at)) {
    const close = line.indexOf("-->", open + 4);
    if (close === -1) break;
    kept += line.slice(at, open);
    at = close + 3;
  }
  return kept + line.slice(at);
}

function openedWrappers(line: string): number {
  let opened = 0;
  for (const [, closing] of withoutComments(line).matchAll(WRAPPER_TAG)) {
    opened += closing ? -1 : 1;
  }
  return opened;
}

/** Null means the block ends on this line. Undefined means no block opens. */
function blockCloser(line: string): ((line: string) => boolean) | null | undefined {
  const fence = FENCE_OPEN.exec(line)?.[1];
  if (fence) {
    return (next) => {
      const closer = FENCE_OPEN.exec(next)?.[1];
      return (
        closer !== undefined &&
        closer[0] === fence[0] &&
        closer.length >= fence.length &&
        !next.trim().slice(closer.length)
      );
    };
  }
  for (const [open, close] of SPANNING_BLOCKS) {
    const opener = open.exec(line)?.[0];
    if (opener === undefined) continue;
    return close.test(line.slice(opener.length)) ? null : (next) => close.test(next);
  }
  return HTML_BLOCK_TAG.test(line) ? closesAtBlankLine : undefined;
}

export interface MarkdownChunk {
  readonly text: string;
  readonly lines: number;
}

const FRONTMATTER_OPEN = /^\uFEFF?---[ \t]*\r?$/;
const FRONTMATTER_CLOSE = /^(?:---|\.\.\.)[ \t]*\r?$/;
// An opening rule with no closer is a thematic break, not frontmatter; stop waiting for one.
const FRONTMATTER_MAX_LINES = 1000;

// A one-line link reference definition; footnotes are left alone so each piece does not grow
// a footnote section.
const LINK_DEFINITION =
  /^ {0,3}\[(?!\^)(?:[^\]\\]|\\.)+\]:[ \t]*(?:<[^<>\n]*>|[^\s<]\S*)(?:[ \t]+(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\((?:[^()\\]|\\.)*\)))?[ \t]*\r?$/;
// Definitions past this are not repeated into every piece; their parse cost would outweigh links.
const SHARED_DEFINITIONS_MAX_CHARS = 16 * 1024;

export interface SplitMarkdown {
  readonly chunks: readonly MarkdownChunk[];
  readonly definitions: string;
}

/**
 * Cuts Markdown into pieces of roughly `targetChars`, only at column-0 headings or paragraphs
 * that start a new top-level block. Leading frontmatter stays in the first piece. Link
 * definitions are collected so every piece can resolve them; footnotes resolve only inside their
 * own piece, and duplicate heading slugs restart per piece.
 */
export function splitMarkdown(text: string, targetChars = CHUNK_TARGET_CHARS): SplitMarkdown {
  const chunks: MarkdownChunk[] = [];
  const definitions: string[] = [];
  let lines: string[] = [];
  let first = true;
  let chars = 0;
  let closes: ((line: string) => boolean) | null = null;
  let afterBlankLine = false;
  let afterDefinition = false;
  let afterHeading = false;
  let ambiguousHtml = false;
  let definitionChars = 0;
  let openWrappers = 0;
  let heldCut = 0;
  const flush = () => {
    chunks.push({ text: lines.join("\n"), lines: lines.length });
    lines = [];
    chars = 0;
    heldCut = 0;
  };
  const sourceLines = text.split("\n");
  let flowStart = 0;
  let parsedThrough = 0;
  let htmlStarts: Set<number> | undefined;
  let parseBudget = HTML_PARSE_BUDGET_CHARS;
  const resetFlow = (start: number) => {
    flowStart = start;
    parsedThrough = start;
    htmlStarts = undefined;
  };
  for (const [lineIndex, line] of sourceLines.entries()) {
    if (closes !== null) {
      if (closes(line)) {
        closes = null;
        resetFlow(lineIndex + 1);
      }
    } else if (first && FRONTMATTER_OPEN.test(line)) {
      let seen = 0;
      closes = (next) => FRONTMATTER_CLOSE.test(next) || ++seen >= FRONTMATTER_MAX_LINES;
    } else {
      if (chars >= WRAPPED_MAX_CHARS) openWrappers = 0;
      const cutPoint =
        !ambiguousHtml &&
        chars >= targetChars &&
        ((line.startsWith("#") && ATX_HEADING.test(line)) ||
          (afterBlankLine && BLOCK_START.test(line) && !ORDERED_ITEM.test(line)));
      if (cutPoint && openWrappers === 0) flush();
      else if (cutPoint) heldCut = lines.length;
      const closer = blockCloser(line);
      closes = closer ?? null;
      if (closer === null || ATX_HEADING.test(line) || THEMATIC_BREAK.test(line)) {
        resetFlow(lineIndex + 1);
      } else if (closer === undefined && HTML_STANDALONE_TAG.test(line)) {
        // Type-7 HTML cannot interrupt prose. Keep ambiguous tags beyond the parse
        // budget with their following lines, as a cut could expose literal HTML as Markdown.
        if (htmlStarts === undefined && lineIndex > flowStart) {
          let end = flowStart;
          let flowChars = 0;
          const maxChars = Math.min(HTML_FLOW_MAX_CHARS, parseBudget);
          for (; end < sourceLines.length; end++) {
            const next = sourceLines[end]!;
            flowChars += next.length + 1;
            if (flowChars > maxChars || next.trim() === "") break;
            // Include the boundary line, which can end a lazy container continuation.
            if (
              ATX_HEADING.test(next) ||
              THEMATIC_BREAK.test(next) ||
              blockCloser(next) !== undefined
            ) {
              end++;
              break;
            }
          }
          parsedThrough = end;
          htmlStarts = new Set();
          if (lineIndex < end) {
            const flowText = sourceLines.slice(flowStart, end).join("\n");
            parseBudget -= flowText.length;
            for (const node of flowParser.parse(flowText).children) {
              if (node.type === "html" && node.position) {
                htmlStarts.add(flowStart + node.position.start.line - 1);
              }
            }
          }
        }
        if (lineIndex === flowStart || htmlStarts?.has(lineIndex)) closes = closesAtBlankLine;
        else if (lineIndex >= parsedThrough) ambiguousHtml = true;
      }
      // A definition cannot interrupt a paragraph, so it follows a blank line, a heading or
      // another definition.
      const definition: boolean =
        !ambiguousHtml &&
        (first || afterBlankLine || afterDefinition || afterHeading) &&
        LINK_DEFINITION.test(line);
      afterDefinition = definition;
      if (definition && definitionChars + line.length < SHARED_DEFINITIONS_MAX_CHARS) {
        definitions.push(line.trim());
        definitionChars += line.length + 1;
      }
    }
    if (closes === closesAtBlankLine)
      openWrappers = Math.max(0, openWrappers + openedWrappers(line));
    first = false;
    lines.push(line);
    chars += line.length + 1;
    // A piece too large to render goes back to the last cut a wrapper held.
    if (heldCut > 0 && chars - 1 > LARGE_MARKDOWN_CHUNK_MAX_CHARS) {
      const rest = lines.splice(heldCut);
      flush();
      lines = rest;
      chars = rest.reduce((sum, kept) => sum + kept.length + 1, 0);
      openWrappers = 0;
    }
    afterBlankLine = line.trim() === "";
    if (afterBlankLine) {
      ambiguousHtml = false;
      resetFlow(lineIndex + 1);
    }
    afterHeading = closes === null && (ATX_HEADING.test(line) || THEMATIC_BREAK.test(line));
  }
  flush();
  return { chunks, definitions: definitions.join("\n") };
}

/** Appends shared link definitions after a piece, leaving its own offsets unchanged. */
export function withMarkdownDefinitions(text: string, definitions: string): string {
  return definitions ? `${text}\n\n${definitions}` : text;
}
