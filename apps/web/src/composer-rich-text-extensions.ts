import { Italic, starInputRegex, starPasteRegex } from "@tiptap/extension-italic";
import { joinBackward, joinTextblockBackward, joinTextblockForward } from "@tiptap/pm/commands";
import {
  Fragment,
  type MarkType,
  type Node as ProseMirrorNode,
  type ResolvedPos,
} from "@tiptap/pm/model";
import { Code } from "@tiptap/extension-code";
import { Blockquote } from "@tiptap/extension-blockquote";
import { CodeBlock } from "@tiptap/extension-code-block";
import { Heading } from "@tiptap/extension-heading";
import { HorizontalRule } from "@tiptap/extension-horizontal-rule";
import {
  type Command,
  type Editor,
  Extension,
  markInputRule,
  markPasteRule,
  mergeAttributes,
} from "@tiptap/core";
import { BulletList, ListItem, OrderedList } from "@tiptap/extension-list";
import { TaskItem } from "@tiptap/extension-task-item";
import { TaskList } from "@tiptap/extension-task-list";
import { Plugin, PluginKey, Selection, TextSelection, type Transaction } from "@tiptap/pm/state";
import { nextOrderedMarkerText } from "~/composer-list-continuation";
import { LIST_NODE_NAMES } from "~/composer-rich-text-doc";

/**
 * Tiptap's code mark excludes every other mark, which rejects the `bold+code`
 * spans markdown like `**\`x\`**` parses into and drops the whole insert.
 * Code nests inside emphasis here, so it only excludes itself like the rest.
 */
type CodePair = { from: number; to: number };

const codePairKey = new PluginKey<CodePair[]>("typedBacktickPairs");

// Input rules only see text before the caret, so filling an already typed
// pair needs a separate exit handler. Only typed pairs opt into that handler.
function codePairCaretPlugin(type: MarkType) {
  return new Plugin<CodePair[]>({
    key: codePairKey,
    state: {
      init: () => [],
      apply(tr, pairs) {
        const mapped = pairs.flatMap((pair) => {
          const from = tr.mapping.mapResult(pair.from, 1);
          const to = tr.mapping.mapResult(pair.to, -1);
          return from.deleted || to.deleted ? [] : [{ from: from.pos, to: to.pos }];
        });
        const typed = tr.getMeta(codePairKey) as CodePair | undefined;
        return typed ? [...mapped, typed] : mapped;
      },
    },
    props: {
      handleTextInput(view, from, to, text, insert) {
        if (view.composing || from !== to || text !== "`") return false;
        const $from = view.state.doc.resolve(from);
        if (
          !$from.parent.isTextblock ||
          $from.parent.type.spec.code ||
          !/(^|[^`])`$/.test($from.nodeBefore?.text ?? "")
        ) {
          return false;
        }
        view.dispatch(insert().setMeta(codePairKey, { from: from - 1, to: from + 1 }));
        return true;
      },
    },
    appendTransaction(transactions, oldState, state) {
      if (!state.selection.empty || oldState.selection.from === state.selection.from) return null;
      if (transactions.some((tr) => tr.docChanged)) return null;
      const pair = codePairKey.getState(state)?.find(({ to }) => to === state.selection.from);
      if (!pair) return null;
      const $start = state.doc.resolve(pair.from);
      const $end = state.selection.$from;
      if (!$start.sameParent($end) || $start.parent.type.spec.code) return null;
      if (
        $start.nodeBefore?.text?.endsWith("`") ||
        $end.nodeAfter?.text?.startsWith("`") ||
        !/^`[^`]+`$/.test(state.doc.textBetween(pair.from, pair.to))
      ) {
        return null;
      }
      let plain = true;
      state.doc.nodesBetween(pair.from, pair.to, (node) => {
        if (node.isInline && (!node.isText || node.marks.length > 0)) plain = false;
      });
      if (!plain) return null;
      const tr = state.tr.delete(pair.to - 1, pair.to).delete(pair.from, pair.from + 1);
      tr.addMark(pair.from, pair.to - 2, type.create());
      tr.setSelection(TextSelection.create(tr.doc, pair.to - 2));
      tr.removeStoredMark(type);
      return tr;
    },
  });
}

export const ComposerCodeExtension = Code.extend({
  excludes: "code",
  // The forward arrow leaves code through the caret stops at styled edges, so
  // the stock exit (inserting a space at the end of a line) is not needed.
  exitable: false,
  // Code reads left to right inside an Arabic or Hebrew line, and the isolate
  // keeps its punctuation from trading places with the text around it.
  addOptions() {
    return { ...this.parent!(), HTMLAttributes: { dir: "ltr" } };
  },
  addProseMirrorPlugins() {
    return [...(this.parent?.() ?? []), codePairCaretPlugin(this.type)];
  },
});

export const ComposerItalicExtension = Italic.extend({
  addInputRules() {
    return [markInputRule({ find: starInputRegex, type: this.type })];
  },
  addPasteRules() {
    return [markPasteRule({ find: starPasteRegex, type: this.type })];
  },
});

function withoutBlockChords<Shortcuts extends Record<string, unknown>>(
  shortcuts: Shortcuts | undefined,
  drop: readonly string[],
): Shortcuts {
  return Object.fromEntries(
    Object.entries(shortcuts ?? {}).filter(([key]) => !drop.includes(key)),
  ) as Shortcuts;
}

const LIST_ITEM_CONTENT = "paragraph list*";

export const ComposerTaskListExtension = TaskList.extend({
  addKeyboardShortcuts() {
    return withoutBlockChords(this.parent?.(), ["Mod-Shift-9"]);
  },
});

const LIST_NESTING_KEYS = ["Tab", "Shift-Tab"];

/**
 * Task list items keep their exact source indent in an attribute so nesting
 * round-trips byte-identically. Checkbox case (`[X]`) normalizes to `[x]` —
 * the same fixed-point deal as `__bold__` becoming `**bold**`.
 */
export const ComposerTaskItemExtension = TaskItem.extend({
  content: LIST_ITEM_CONTENT,
  addAttributes() {
    return {
      ...this.parent?.(),
      indent: { default: "" },
      markerSpace: { default: " " },
      contentSpace: { default: null },
    };
  },
  addKeyboardShortcuts() {
    return withoutBlockChords(this.parent?.(), LIST_NESTING_KEYS);
  },
}).configure({ nested: true });

export const ComposerCodeBlockExtension = CodeBlock.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      language: { default: "" },
      fence: { default: "```" },
      close: { default: "\n```" },
    };
  },
  addKeyboardShortcuts() {
    return {
      ...withoutBlockChords(this.parent?.(), ["Mod-Alt-c"]),
      Backspace: () => unwrapCodeBlockAtStart(this.editor),
    };
  },
});

function unwrapCodeBlockAtStart(editor: Editor): boolean {
  const { $from, empty } = editor.state.selection;
  if (!empty || $from.parent.type.name !== "codeBlock" || $from.parentOffset !== 0) return false;
  const { schema } = editor.state;
  const paragraphs = $from.parent.textContent
    .split("\n")
    .map((line) => schema.nodes.paragraph!.create(null, line ? schema.text(line) : null));
  const start = $from.before();
  const tr = editor.state.tr.replaceWith(start, $from.after(), paragraphs);
  editor.view.dispatch(tr.setSelection(TextSelection.create(tr.doc, start + 1)));
  return true;
}

const ComposerListItemExtension = ListItem.extend({
  content: LIST_ITEM_CONTENT,
  addAttributes() {
    return {
      ...this.parent?.(),
      indent: { default: "" },
      marker: { default: "-" },
      space: { default: " " },
    };
  },
  addKeyboardShortcuts() {
    return {
      ...withoutBlockChords(this.parent?.(), LIST_NESTING_KEYS),

      Backspace: () => backspaceAcrossList(this.editor),
      Delete: () => deleteAcrossList(this.editor),
    };
  },

  renderHTML({ node, HTMLAttributes }) {
    const marker = String(node.attrs.marker);
    return [
      "li",
      mergeAttributes(HTMLAttributes, {
        "data-marker": marker,
        "data-marker-width": Math.min(marker.length, 10),
      }),
      0,
    ];
  },
});

export const ComposerListExtensions = [
  BulletList.extend({
    addKeyboardShortcuts() {
      return withoutBlockChords(this.parent?.(), ["Mod-Shift-8"]);
    },
  }),
  OrderedList.extend({
    addKeyboardShortcuts() {
      return withoutBlockChords(this.parent?.(), ["Mod-Shift-7"]);
    },
  }),
  ComposerListItemExtension,
];

const ComposerBlockquoteExtension = Blockquote.extend({
  content: "paragraph+",
  addAttributes() {
    return { ...this.parent?.(), prefix: { default: "> " } };
  },
  addKeyboardShortcuts() {
    return withoutBlockChords(this.parent?.(), ["Mod-Shift-b"]);
  },
});

const ComposerHorizontalRuleExtension = HorizontalRule.extend({
  addAttributes() {
    return { ...this.parent?.(), source: { default: "---" } };
  },
  addProseMirrorPlugins() {
    return [
      ...(this.parent?.() ?? []),
      new Plugin({
        appendTransaction: (transactions, _, state) => {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          if (state.doc.lastChild?.type.name !== "horizontalRule") return null;
          return state.tr.insert(state.doc.content.size, state.schema.nodes.paragraph!.create());
        },
      }),
    ];
  },
});

const ComposerHeadingExtension = Heading.extend({
  addAttributes() {
    return { ...this.parent?.(), space: { default: " " } };
  },

  addKeyboardShortcuts() {
    return {};
  },
});

export const ComposerBlockExtensions = [
  ComposerBlockquoteExtension,
  ComposerHorizontalRuleExtension,
  ComposerHeadingExtension,
];

function alignListItemWithSiblings(tr: Transaction, itemType: string): void {
  const $pos = tr.selection.$from;

  if ($pos.depth < 3 || $pos.node(-1).type.name !== itemType) return;
  const item = $pos.node(-1);
  const list = $pos.node(-2);
  const index = $pos.index(-2);
  const sibling =
    index > 0 ? list.child(index - 1) : index + 1 < list.childCount ? list.child(index + 1) : null;
  if (!sibling) return;
  const attrs: Record<string, unknown> = { ...item.attrs, indent: sibling.attrs.indent };
  if (item.type.name === "taskItem") {
    attrs.markerSpace = sibling.attrs.markerSpace;
  } else {
    const marker = typeof sibling.attrs.marker === "string" ? sibling.attrs.marker : "-";
    attrs.marker = index > 0 && /^\d+[.)]$/.test(marker) ? nextOrderedMarkerText(marker) : marker;
  }
  tr.setNodeMarkup($pos.before(-1), undefined, attrs);
  if (typeof attrs.marker === "string" && /^\d+[.)]$/.test(attrs.marker)) {
    renumberFollowingItems(tr, $pos.before(-2), index, attrs.marker);
  }
}

function renumberFollowingItems(
  tr: Transaction,
  listPos: number,
  index: number,
  marker: string,
): void {
  const list = tr.doc.nodeAt(listPos);
  if (!list) return;
  let pos = listPos + 1;
  let previous = marker;
  list.forEach((child, _, childIndex) => {
    if (childIndex > index) {
      previous = nextOrderedMarkerText(previous);
      if (child.attrs.marker !== previous) {
        tr.setNodeMarkup(pos, undefined, { ...child.attrs, marker: previous });
      }
    }
    pos += child.nodeSize;
  });
}

export function splitOrLiftListItem(editor: Editor): boolean {
  const $from = editor.state.selection.$from;
  const itemType = listItemTypeAt($from);
  if (!itemType) return false;
  const empty = $from.parent.content.size === 0;

  const move: Command = ({ commands, tr }) => {
    const moved =
      commands.splitListItem(
        itemType,
        itemType === "taskItem" ? { checked: false } : { space: " " },
      ) ||
      (empty && commands.liftListItem(itemType));
    if (moved) alignListItemWithSiblings(tr, itemType);
    return moved;
  };
  return editor.can().command(move) && editor.chain().command(move).run();
}

export function convertBulletItemToTask(
  tr: Transaction,
  from: number,
  to: number,
  checked: boolean,
): void {
  tr.delete(from, to);
  const $pos = tr.doc.resolve(from);
  const item = $pos.node(-1);
  const list = $pos.node(-2);
  const index = $pos.index(-2);
  const { schema } = tr.doc.type;
  const before: ProseMirrorNode[] = [];
  const after: ProseMirrorNode[] = [];
  list.forEach((child, _, childIndex) => {
    if (childIndex < index) before.push(child);
    else if (childIndex > index) after.push(child);
  });

  const markerSpace =
    typeof item.attrs.space === "string" && item.attrs.space ? item.attrs.space : " ";
  const task = schema.nodes.taskItem!.create(
    { checked, indent: item.attrs.indent, markerSpace },
    item.content,
  );
  const lists = [
    ...(before.length > 0 ? [list.copy(Fragment.from(before))] : []),
    schema.nodes.taskList!.create(null, task),
    ...(after.length > 0 ? [list.copy(Fragment.from(after))] : []),
  ];
  const listStart = $pos.before(-2);
  tr.replaceWith(listStart, listStart + list.nodeSize, lists);

  const caret = listStart + (before.length > 0 ? lists[0]!.nodeSize : 0) + 3;
  tr.setSelection(TextSelection.create(tr.doc, caret));
}

function listItemTypeAt($pos: ResolvedPos): "listItem" | "taskItem" | null {
  const name = $pos.depth > 1 ? $pos.node(-1).type.name : null;
  return name === "listItem" || name === "taskItem" ? name : null;
}

function backspaceAcrossList(editor: Editor): boolean {
  const { state } = editor;
  const { $from, empty } = state.selection;
  if (!empty || $from.parentOffset !== 0) return false;
  const itemType = listItemTypeAt($from);
  if (itemType && $from.index(-1) === 0) {
    const lift: Command = ({ commands, tr }) => {
      const moved = commands.liftListItem(itemType);
      if (moved) alignListItemWithSiblings(tr, itemType);
      return moved;
    };

    return editor.chain().command(lift).run() || joinBackward(state, editor.view.dispatch);
  }
  const before = $from.depth === 1 ? $from.node(0).maybeChild($from.index(0) - 1) : null;
  if (before && LIST_NODE_NAMES.has(before.type.name) && $from.parent.type.name !== "codeBlock") {
    return joinTextblockBackward(state, editor.view.dispatch);
  }
  return false;
}

function deleteAcrossList(editor: Editor): boolean {
  const { state } = editor;
  const { $from, empty } = state.selection;
  if (!empty || !$from.parent.isTextblock || $from.depth === 0) return false;
  if ($from.parentOffset !== $from.parent.content.size) return false;
  const next = Selection.findFrom(state.doc.resolve($from.after()), 1, true);
  if (!next) return false;
  if (next.$from.parent.type.name === "codeBlock") return $from.parent.type.name !== "codeBlock";
  if (!listItemTypeAt($from) && !listItemTypeAt(next.$from)) return false;
  return joinTextblockForward(state, editor.view.dispatch);
}

/**
 * Mod+B bolds selected text only. Without a selection Tiptap would toggle bold
 * for the next typed text, which users hit by accident when they mean the
 * sidebar toggle. Runs ahead of the Bold extension and swallows the chord.
 */
export const ComposerBoldSelectionOnlyExtension = Extension.create({
  name: "composerBoldSelectionOnly",
  priority: 1000,
  addKeyboardShortcuts() {
    const ignoreWithoutSelection = () => this.editor.state.selection.empty;
    return { "Mod-b": ignoreWithoutSelection, "Mod-B": ignoreWithoutSelection };
  },
});
