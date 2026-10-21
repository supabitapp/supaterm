import type { SkillMeta } from "./composer-rich-text-doc";
import { Fragment, Mark, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { EditorState } from "@tiptap/pm/state";
import type { Transaction } from "@tiptap/pm/state";
import { splitPromptIntoComposerSegments } from "~/composer-editor-mentions";
import {
  MARK_NESTING_ORDER,
  TIPTAP_TO_MARK,
  RICH_TEXT_DELIMITERS,
  type RichTextMark,
} from "~/composer-rich-text";
import { collectInlineContextIds } from "~/lib/composerContextReferences";
import { codeBlockSource, LIST_NODE_NAMES, LIST_ITEM_NODE_NAMES } from "~/composer-rich-text-doc";

function isTrailingLineAfterRule(doc: ProseMirrorNode, index: number): boolean {
  const block = doc.child(index);
  return (
    index === doc.childCount - 1 &&
    index > 0 &&
    block.type.name === "paragraph" &&
    block.content.size === 0 &&
    doc.child(index - 1).type.name === "horizontalRule"
  );
}

export interface RichRun {
  kind: "text" | "token" | "break" | "prefix";
  /** Flat document offset (atoms count 1, markers excluded). */
  flatStart: number;
  docLen: number;
  /** Collapsed cursor length (markers literal, tokens count 1). */
  collapsedLen: number;
  /** Markdown length (tokens expand to their source). */
  mdLen: number;
  /** Marker layout inside text runs. */
  openLen: number;
  closeLen: number;
  /** ProseMirror position of the run start. */
  pmPos: number;
  mdStart: number;
  collapsedStart: number;
  nodeName?: string;
}

export interface RichDocMap {
  value: string;
  runs: RichRun[];
  docLength: number;
  contextIds: string[];
}

function readAtomSource(node: ProseMirrorNode): string {
  const attrs = node.attrs as Record<string, unknown>;
  switch (node.type.name) {
    case "composer-mention":
    case "composer-citation":
    case "composer-context-reference":
      return typeof attrs.source === "string" ? attrs.source : "";
    case "composer-skill": {
      const name = typeof attrs.skillName === "string" ? attrs.skillName : "";
      return name ? `$${name}` : "";
    }
    default:
      return "";
  }
}

interface RichAccumulator {
  runs: RichRun[];
  value: string;
  flat: number;
  collapsed: number;
  md: number;
}

function pushBreakRun(acc: RichAccumulator, position?: number): void {
  const previous = acc.runs[acc.runs.length - 1];
  const pmPos = position ?? (previous ? previous.pmPos + previous.docLen : 1);
  // Block boundary: one newline in every coordinate space.
  acc.runs.push({
    kind: "break",
    flatStart: acc.flat,
    docLen: 1,
    collapsedLen: 1,
    mdLen: 1,
    openLen: 0,
    closeLen: 0,
    pmPos,
    mdStart: acc.md,
    collapsedStart: acc.collapsed,
  });
  acc.value += "\n";
  acc.flat += 1;
  acc.collapsed += 1;
  acc.md += 1;
}

function pushBlankLineRun(acc: RichAccumulator, pmPos: number): void {
  acc.runs.push({
    kind: "prefix",
    flatStart: acc.flat,
    docLen: 0,
    collapsedLen: 1,
    mdLen: 1,
    openLen: 0,
    closeLen: 0,
    pmPos,
    mdStart: acc.md,
    collapsedStart: acc.collapsed,
  });
  acc.value += "\n";
  acc.collapsed += 1;
  acc.md += 1;
}

function appendInlineRuns(
  container: ProseMirrorNode,
  contentStart: number,
  acc: RichAccumulator,
): void {
  const children: ProseMirrorNode[] = [];
  container.forEach((child) => {
    if (!child.isText || child.marks.some((mark) => mark.type.name === "code")) {
      children.push(child);
      return;
    }
    // Separate boundary whitespace so delimiters can move past it without
    // changing the document offsets or marks on the visible text.
    const text = child.text!;
    const start = text.length - text.trimStart().length;
    const end = Math.max(start, text.trimEnd().length);
    let offset = 0;
    for (const boundary of [start, end, text.length]) {
      if (boundary > offset) children.push(child.cut(offset, boundary));
      offset = boundary;
    }
  });
  // Emphasis cannot open or close next to whitespace. Retain a whitespace
  // mark only when its range has visible content on both sides.
  for (const mark of MARK_NESTING_ORDER) {
    if (mark === "code") continue;
    for (const direction of [1, -1]) {
      let hasContent = false;
      for (
        let index = direction === 1 ? 0 : children.length - 1;
        index >= 0 && index < children.length;
        index += direction
      ) {
        const child = children[index]!;
        if (
          child.type.name === "hardBreak" ||
          !child.marks.some((item) => item.type.name === mark)
        ) {
          hasContent = false;
        } else if (
          child.isText &&
          !child.marks.some((item) => item.type.name === "code") &&
          /^\s+$/.test(child.text!)
        ) {
          if (!hasContent)
            children[index] = child.mark(child.marks.filter((item) => item.type.name !== mark));
        } else {
          hasContent = true;
        }
      }
    }
  }
  // Longer shared marks surround shorter ones. This keeps both nested
  // formatting and formatting across chips inside a single delimiter pair.
  const markEnds = new Map<RichTextMark, number>();
  const orderedMarks: RichTextMark[][] = [];
  for (let index = children.length - 1; index >= 0; index -= 1) {
    const child = children[index]!;
    const marks =
      child.type.name === "hardBreak"
        ? []
        : child.marks
            .map((mark) => TIPTAP_TO_MARK[mark.type.name])
            .filter((mark): mark is RichTextMark => Boolean(mark));
    for (const mark of MARK_NESTING_ORDER) {
      if (!marks.includes(mark)) markEnds.delete(mark);
      else if (!markEnds.has(mark)) markEnds.set(mark, index);
    }
    orderedMarks[index] = marks.sort(
      (a, b) =>
        markEnds.get(b)! - markEnds.get(a)! ||
        MARK_NESTING_ORDER.indexOf(a) - MARK_NESTING_ORDER.indexOf(b),
    );
  }
  for (let index = 1; index < orderedMarks.length; index += 1) {
    const marks = orderedMarks[index]!;
    const retained: RichTextMark[] = [];
    for (const mark of orderedMarks[index - 1]!) {
      if (!marks.includes(mark)) break;
      retained.push(mark);
    }
    orderedMarks[index] = [...retained, ...marks.filter((mark) => !retained.includes(mark))];
  }
  const commonLength = (left: RichTextMark[], right: RichTextMark[]) => {
    let index = 0;
    while (index < left.length && left[index] === right[index]) index += 1;
    return index;
  };
  let inlineOffset = 0;
  children.forEach((child, index) => {
    const pmPos = contentStart + inlineOffset;
    inlineOffset += child.nodeSize;
    if (child.type.name === "hardBreak") {
      pushBreakRun(acc, pmPos);
      return;
    }
    const marks = orderedMarks[index]!;
    const open = marks
      .slice(commonLength(marks, orderedMarks[index - 1] ?? []))
      .map((mark) => RICH_TEXT_DELIMITERS[mark])
      .join("");
    const close = marks
      .slice(commonLength(marks, orderedMarks[index + 1] ?? []))
      .toReversed()
      .map((mark) => RICH_TEXT_DELIMITERS[mark])
      .join("");
    const source = child.isText ? child.text! : readAtomSource(child);
    const docLen = child.isText ? source.length : 1;
    const mdText = open + source + close;
    const collapsedLen = open.length + docLen + close.length;
    acc.runs.push({
      kind: child.isText ? "text" : "token",
      flatStart: acc.flat,
      docLen,
      collapsedLen,
      mdLen: mdText.length,
      openLen: open.length,
      closeLen: close.length,
      pmPos,
      mdStart: acc.md,
      collapsedStart: acc.collapsed,
      ...(child.isText ? {} : { nodeName: child.type.name }),
    });
    acc.value += mdText;
    acc.flat += docLen;
    acc.collapsed += collapsedLen;
    acc.md += mdText.length;
  });
  // Empty paragraphs have an editable position even though they emit no text.
  if (children.length === 0) {
    acc.runs.push({
      kind: "text",
      flatStart: acc.flat,
      docLen: 0,
      collapsedLen: 0,
      mdLen: 0,
      openLen: 0,
      closeLen: 0,
      pmPos: contentStart,
      mdStart: acc.md,
      collapsedStart: acc.collapsed,
    });
  }
}

function listItemPrefix(item: ProseMirrorNode, empty: boolean): string {
  const attrs = item.attrs as Record<string, unknown>;
  const indent = typeof attrs.indent === "string" ? attrs.indent : "";
  if (item.type.name === "taskItem") {
    const markerSpace = typeof attrs.markerSpace === "string" ? attrs.markerSpace : " ";
    const contentSpace =
      typeof attrs.contentSpace === "string"
        ? attrs.contentSpace || (empty ? "" : " ")
        : empty
          ? ""
          : " ";
    return `${indent}-${markerSpace}[${attrs.checked === true ? "x" : " "}]${contentSpace}`;
  }
  const marker = typeof attrs.marker === "string" && attrs.marker ? attrs.marker : "-";

  const space =
    typeof attrs.space === "string" ? attrs.space || (empty ? "" : " ") : empty ? "" : " ";
  return `${indent}${marker}${space}`;
}

function walkList(list: ProseMirrorNode, listStart: number, acc: RichAccumulator): void {
  let itemPos = listStart + 1;
  let firstItem = true;
  list.content.forEach((item) => {
    // Sibling items are separated by one newline in every coordinate space.
    if (!firstItem) pushBreakRun(acc);
    firstItem = false;
    const itemContentStart = itemPos + 1;
    const first = item.firstChild;
    const empty = first?.type.name === "paragraph" && first.content.childCount === 0;
    const prefix = listItemPrefix(item, empty);

    // to the start of the item text, exactly like style markers.
    acc.runs.push({
      kind: "prefix",
      flatStart: acc.flat,
      docLen: 0,
      collapsedLen: prefix.length,
      mdLen: prefix.length,
      openLen: 0,
      closeLen: 0,
      pmPos: itemContentStart + 1,
      mdStart: acc.md,
      collapsedStart: acc.collapsed,
    });
    acc.value += prefix;
    acc.collapsed += prefix.length;
    acc.md += prefix.length;
    let childPos = itemContentStart;
    let firstBlock = true;
    item.content.forEach((child) => {
      if (!firstBlock) pushBreakRun(acc);
      firstBlock = false;
      if (LIST_NODE_NAMES.has(child.type.name)) {
        walkList(child, childPos, acc);
      } else if (child.type.name === "paragraph") {
        appendInlineRuns(child, childPos + 1, acc);
      }
      childPos += child.nodeSize;
    });
    itemPos += item.nodeSize;
  });
}

function appendCodeBlockRun(
  block: ProseMirrorNode,
  pmPos: number,
  followed: boolean,
  acc: RichAccumulator,
): void {
  const { open, content, close } = codeBlockSource(block, followed);
  const pieces = content
    ? splitPromptIntoComposerSegments(content).map((segment) =>
        segment.type === "text"
          ? { length: segment.text.length, collapsedLen: segment.text.length }
          : { length: segment.source.length, collapsedLen: 1 },
      )
    : [{ length: 0, collapsedLen: 0 }];
  let offset = 0;
  pieces.forEach((piece, index) => {
    const openLen = index === 0 ? open.length : 0;
    const closeLen = index === pieces.length - 1 ? close.length : 0;
    const collapsedLen = openLen + piece.collapsedLen + closeLen;
    const mdLen = openLen + piece.length + closeLen;
    acc.runs.push({
      kind: "text",
      flatStart: acc.flat,
      docLen: piece.length,
      collapsedLen,
      mdLen,
      openLen,
      closeLen,
      pmPos: pmPos + offset,
      mdStart: acc.md,
      collapsedStart: acc.collapsed,
      nodeName: "codeBlock",
    });
    offset += piece.length;
    acc.flat += piece.length;
    acc.collapsed += collapsedLen;
    acc.md += mdLen;
  });
  acc.value += open + content + close;
}

function walkBlockquote(quote: ProseMirrorNode, quoteStart: number, acc: RichAccumulator): void {
  const attrs = quote.attrs as Record<string, unknown>;
  const prefix = typeof attrs.prefix === "string" ? attrs.prefix : "> ";
  let childPos = quoteStart + 1;
  let firstLine = true;
  quote.content.forEach((child) => {
    if (!firstLine) pushBreakRun(acc);
    firstLine = false;
    acc.runs.push({
      kind: "prefix",
      flatStart: acc.flat,
      docLen: 0,
      collapsedLen: prefix.length,
      mdLen: prefix.length,
      openLen: 0,
      closeLen: 0,
      pmPos: childPos + 1,
      mdStart: acc.md,
      collapsedStart: acc.collapsed,
    });
    acc.value += prefix;
    acc.collapsed += prefix.length;
    acc.md += prefix.length;
    if (child.type.name === "paragraph") appendInlineRuns(child, childPos + 1, acc);
    childPos += child.nodeSize;
  });
}

export function serializeSelection(doc: ProseMirrorNode, from: number, to: number): string {
  const slice = doc.slice(from, to);
  const $from = doc.resolve(from);
  let depth = $from.sharedDepth(to);
  let content: Fragment | ProseMirrorNode = slice.content;
  if (slice.content.firstChild?.isInline) {
    content = doc.type.schema.nodes.paragraph!.create(null, slice.content);
  } else {
    while (depth > 0) {
      const shared = $from.node(depth);
      content = shared.copy(Fragment.from(content));
      if (!LIST_ITEM_NODE_NAMES.has(shared.type.name)) break;
      depth -= 1;
    }
  }
  return serializeEditorDoc(doc.type.create(null, content)).value;
}

export function serializeEditorDoc(doc: ProseMirrorNode): RichDocMap {
  const acc: RichAccumulator = { runs: [], value: "", flat: 0, collapsed: 0, md: 0 };
  const blocks: ProseMirrorNode[] = [];
  doc.content.forEach((node) => {
    blocks.push(node);
  });

  let pmBlockStart = 0;
  blocks.forEach((block, blockIndex) => {
    if (blockIndex > 0 && !isTrailingLineAfterRule(doc, blockIndex)) pushBreakRun(acc);
    if (
      blocks[blockIndex - 1]?.type.name === "blockquote" &&
      block.type.name === "paragraph" &&
      block.content.size > 0
    )
      pushBlankLineRun(acc, pmBlockStart + 1);
    if (LIST_NODE_NAMES.has(block.type.name)) {
      walkList(block, pmBlockStart, acc);
    } else if (block.type.name === "codeBlock") {
      appendCodeBlockRun(block, pmBlockStart + 1, blockIndex < blocks.length - 1, acc);
    } else if (block.type.name === "blockquote") {
      walkBlockquote(block, pmBlockStart, acc);
    } else if (block.type.name === "heading") {
      const attrs = block.attrs as Record<string, unknown>;
      const level = typeof attrs.level === "number" ? attrs.level : 1;
      const space = typeof attrs.space === "string" ? attrs.space : " ";
      const prefix = `${"#".repeat(level)}${space}`;
      acc.runs.push({
        kind: "prefix",
        flatStart: acc.flat,
        docLen: 0,
        collapsedLen: prefix.length,
        mdLen: prefix.length,
        openLen: 0,
        closeLen: 0,
        pmPos: pmBlockStart + 1,
        mdStart: acc.md,
        collapsedStart: acc.collapsed,
      });
      acc.value += prefix;
      acc.collapsed += prefix.length;
      acc.md += prefix.length;
      appendInlineRuns(block, pmBlockStart + 1, acc);
    } else if (block.type.name === "horizontalRule") {
      const attrs = block.attrs as Record<string, unknown>;
      const source = typeof attrs.source === "string" && attrs.source ? attrs.source : "---";
      acc.runs.push({
        kind: "prefix",
        flatStart: acc.flat,
        docLen: 0,
        collapsedLen: source.length,
        mdLen: source.length,
        openLen: 0,
        closeLen: 0,
        pmPos: pmBlockStart + block.nodeSize,
        mdStart: acc.md,
        collapsedStart: acc.collapsed,
      });
      acc.value += source;
      acc.collapsed += source.length;
      acc.md += source.length;
    } else if (block.type.name === "paragraph") {
      appendInlineRuns(block, pmBlockStart + 1, acc);
    }
    pmBlockStart += block.nodeSize;
  });

  return {
    value: acc.value,
    runs: acc.runs,
    docLength: acc.flat,
    contextIds: Array.from(new Set(collectInlineContextIds(acc.value))),
  };
}

function lastRunEnd(map: RichDocMap, space: "collapsed" | "md"): number {
  const last = map.runs[map.runs.length - 1];
  if (!last) return 0;
  return space === "collapsed"
    ? last.collapsedStart + last.collapsedLen
    : last.mdStart + last.mdLen;
}

function runOwnsOffset(run: RichRun, flatOffset: number): boolean {
  const end = run.flatStart + run.docLen;
  return flatOffset < end || (flatOffset === end && run.nodeName === "codeBlock");
}

export function flatToCollapsed(map: RichDocMap, flatOffset: number): number {
  const bounded = Math.max(0, Math.min(flatOffset, map.docLength));
  for (const run of map.runs) {
    if (runOwnsOffset(run, bounded)) {
      if (run.kind === "text" || run.kind === "token") {
        const within = Math.min(
          bounded - run.flatStart,
          run.collapsedLen - run.openLen - run.closeLen,
        );
        return run.collapsedStart + run.openLen + within;
      }
      return run.collapsedStart + (bounded - run.flatStart);
    }
  }
  return lastRunEnd(map, "collapsed");
}

export function flatToMarkdown(map: RichDocMap, flatOffset: number): number {
  const bounded = Math.max(0, Math.min(flatOffset, map.docLength));
  for (const run of map.runs) {
    if (runOwnsOffset(run, bounded)) {
      if (run.kind === "text" || run.kind === "token") {
        return run.mdStart + run.openLen + (bounded - run.flatStart);
      }
      return run.mdStart + (bounded - run.flatStart);
    }
  }
  return lastRunEnd(map, "md");
}

export function collapsedToFlat(map: RichDocMap, collapsedOffset: number): number {
  for (const run of map.runs) {
    if (collapsedOffset < run.collapsedStart + run.collapsedLen) {
      // Checkbox prefixes and style markers are shown, never edited: every
      // offset inside them clamps to the adjacent document position.
      if (run.kind === "prefix") return run.flatStart;
      if (run.kind === "text" || run.kind === "token") {
        const within = collapsedOffset - run.collapsedStart;
        const contentLen = run.collapsedLen - run.openLen - run.closeLen;
        // Marker characters clamp to the styled edge: they are shown, never edited.
        if (within <= run.openLen) return run.flatStart;
        if (within >= run.openLen + contentLen) return run.flatStart + run.docLen;
        return run.flatStart + (within - run.openLen);
      }
      return run.flatStart + (collapsedOffset - run.collapsedStart);
    }
  }
  return map.docLength;
}

export function flatToPm(map: RichDocMap, flatOffset: number): number {
  const bounded = Math.max(0, Math.min(flatOffset, map.docLength));
  for (const run of map.runs) {
    if (bounded < run.flatStart + run.docLen) {
      return run.pmPos + (bounded - run.flatStart);
    }
  }
  const last = map.runs[map.runs.length - 1];
  if (!last) return 1;
  return last.pmPos + last.docLen;
}

export function pmToFlat(map: RichDocMap, pmPos: number): number {
  for (const run of map.runs) {
    if (pmPos >= run.pmPos && pmPos <= run.pmPos + run.docLen) {
      // A position on a chip's trailing edge belongs after the chip.
      if (run.kind === "token" && pmPos === run.pmPos + run.docLen) {
        return run.flatStart + run.docLen;
      }
      return run.flatStart + Math.min(pmPos - run.pmPos, run.docLen);
    }
  }
  // A paragraph boundary position belongs to the newline between paragraphs.
  let best = 0;
  for (const run of map.runs) {
    if (run.pmPos <= pmPos) best = run.flatStart + run.docLen;
  }
  return Math.max(0, Math.min(best, map.docLength));
}

// ── Caret stops at styled edges ────────────────────────────────────────────
//
// Markers are decorations, not text, so the position where styled text meets
// unstyled text (or a paragraph edge) is a single document position. The
// caret gets two stops there: one that types with the marks before the edge
// and one that types with the marks after it. Stored marks pick the stop, and
// the revealed markers render on the matching side of the caret, so a pasted
// `**bold**` at the start of a line can still be typed in front of.

function styledEdge(state: EditorState) {
  const { selection } = state;
  if (!selection.empty) return null;
  const { $from } = selection;
  if (!$from.parent.inlineContent) return null;
  const before = $from.nodeBefore?.marks ?? Mark.none;
  const after = $from.nodeAfter?.marks ?? Mark.none;
  if (Mark.sameSet(before, after)) return null;
  return { before, after, current: state.storedMarks ?? $from.marks() };
}

/** True when the caret sits on a styled edge and types with the marks before it. */
export function caretTakesMarksBefore(state: EditorState): boolean {
  const edge = styledEdge(state);
  return edge !== null && Mark.sameSet(edge.current, edge.before);
}

/**
 * Moves the caret to the other stop of the styled edge it sits on, toward
 * `direction`. Returns null when there is no stop to take, so the arrow key
 * moves the caret as usual.
 */
export function stepCaretAcrossStyledEdge(
  state: EditorState,
  direction: -1 | 1,
): Transaction | null {
  const edge = styledEdge(state);
  if (!edge) return null;
  // Marks the user toggled by hand (neither stop) are theirs: move as usual.
  if (!Mark.sameSet(edge.current, edge.before) && !Mark.sameSet(edge.current, edge.after)) {
    return null;
  }
  const target = direction === -1 ? edge.before : edge.after;
  if (Mark.sameSet(edge.current, target)) return null;
  return state.tr.setStoredMarks(target);
}

export interface SkillChipReplacement {
  from: number;
  to: number;
  node: ProseMirrorNode;
}

/**
 * Use the same Markdown token boundaries as draft restoration. Apply edits
 * last-first so positions stay valid and unrelated citation nodes keep their keys.
 */
export function skillChipReplacements(
  doc: ProseMirrorNode,
  skillLabelFor: (name: string) => SkillMeta | null,
): SkillChipReplacement[] {
  const schema = doc.type.schema;
  const skillType = schema.nodes["composer-skill"];
  if (!skillType) return [];
  const replacements: SkillChipReplacement[] = [];
  doc.descendants((node, pos) => {
    if (node.type !== skillType) return;
    const name = typeof node.attrs.skillName === "string" ? node.attrs.skillName : "";
    if (name && !skillLabelFor(name)) {
      replacements.push({
        from: pos,
        to: pos + node.nodeSize,
        node: schema.text(readAtomSource(node), node.marks),
      });
    }
  });
  const map = serializeEditorDoc(doc);
  let end = 0;
  for (const segment of splitPromptIntoComposerSegments(map.value)) {
    const start = end;
    end += segment.type === "text" ? segment.text.length : segment.source.length;
    if (segment.type !== "skill") continue;
    const meta = skillLabelFor(segment.name);
    if (!meta) continue;
    // Only text needs converting; an existing chip is a token run.
    const run = map.runs.find(
      (candidate) =>
        candidate.kind === "text" &&
        candidate.nodeName !== "codeBlock" &&
        start >= candidate.mdStart + candidate.openLen &&
        end <= candidate.mdStart + candidate.openLen + candidate.docLen,
    );
    if (!run) continue;
    const from = run.pmPos + (start - run.mdStart - run.openLen);
    replacements.push({
      from,
      to: from + segment.source.length,
      node: skillType.create(
        { skillName: segment.name, skillLabel: meta.label, skillDescription: meta.description },
        null,
        doc.nodeAt(from)?.marks,
      ),
    });
  }
  return replacements.sort((left, right) => right.from - left.from);
}

export function markdownToFlat(map: RichDocMap, markdownOffset: number): number {
  for (const run of map.runs) {
    if (markdownOffset < run.mdStart + run.mdLen) {
      if (run.kind === "prefix") return run.flatStart;
      if (run.kind === "text" || run.kind === "token") {
        const within = markdownOffset - run.mdStart;
        if (within <= run.openLen) return run.flatStart;
        // A chip is one document position however long its source is.
        if (run.kind === "token" || within >= run.openLen + run.docLen) {
          return run.flatStart + run.docLen;
        }
        return run.flatStart + (within - run.openLen);
      }
      return run.flatStart + (markdownOffset - run.mdStart);
    }
  }
  return map.docLength;
}
