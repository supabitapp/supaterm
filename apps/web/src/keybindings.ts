import {
  type KeybindingCommand,
  type KeybindingShortcut,
  type KeybindingWhenNode,
  type ResolvedKeybindingRule,
  MODEL_PICKER_JUMP_KEYBINDING_COMMANDS,
  type ResolvedKeybindingsConfig,
  THREAD_JUMP_KEYBINDING_COMMANDS,
  type ModelPickerJumpKeybindingCommand,
  type ThreadJumpKeybindingCommand,
} from "@supaterm/contracts";
import {
  isMacPlatform,
  matchesKeybindingShortcut,
  matchesKeybindingShortcutModifiers,
  normalizeEventKey,
  resolveEventKeys,
  shortcutConflictKey,
  type ShortcutEventLike as SharedShortcutEventLike,
  type ShortcutModifierStateLike,
} from "@supaterm/shared/keybindings";
import { isElectron } from "./env";
import { isEditableFocused } from "./lib/editableFocus";
import { projectScriptIdFromCommand } from "./projectScripts";

export type { ShortcutModifierStateLike } from "@supaterm/shared/keybindings";
export { shortcutKeyFromEvent } from "@supaterm/shared/keybindings";

export interface ShortcutEventLike extends SharedShortcutEventLike {
  target?: EventTarget | null;
}

export interface ShortcutMatchContext {
  terminalFocus: boolean;
  terminalOpen: boolean;
  previewFocus: boolean;
  previewOpen: boolean;
  isWeb: boolean;
  isDesktop: boolean;
  editableFocus?: boolean;
  [key: string]: boolean;
}

interface ShortcutMatchOptions {
  platform?: string;
  context?: Partial<ShortcutMatchContext>;
}

export interface ResolvedShortcutLabelOptions extends ShortcutMatchOptions {
  platform?: string;
}

const TERMINAL_WORD_BACKWARD = "\u001bb";
const TERMINAL_WORD_FORWARD = "\u001bf";
const TERMINAL_LINE_START = "\u0001";
const TERMINAL_LINE_END = "\u0005";
const TERMINAL_DELETE_TO_LINE_START = "\u0015";
function resolvePlatform(options: ShortcutMatchOptions | undefined) {
  return options?.platform ?? navigator.platform;
}

function resolveContext(options: ShortcutMatchOptions | undefined): ShortcutMatchContext;
function resolveContext(options: ShortcutMatchOptions | undefined) {
  return {
    terminalFocus: false,
    terminalOpen: false,
    previewFocus: false,
    previewOpen: false,
    isWeb: !isElectron,
    isDesktop: isElectron,
    editableFocus: false,
    ...options?.context,
  } satisfies ShortcutMatchContext;
}

function evaluateWhenNode(node: KeybindingWhenNode, context: ShortcutMatchContext): boolean;
function evaluateWhenNode(node: KeybindingWhenNode, context: ShortcutMatchContext) {
  switch (node.type) {
    case "identifier":
      if (node.name === "true") return true satisfies boolean;
      if (node.name === "false") return false satisfies boolean;
      return Boolean(context[node.name]) satisfies boolean;
    case "not":
      return !evaluateWhenNode(node.node, context) satisfies boolean;
    case "and":
      return (evaluateWhenNode(node.left, context) &&
        evaluateWhenNode(node.right, context)) satisfies boolean;
    case "or":
      return (evaluateWhenNode(node.left, context) ||
        evaluateWhenNode(node.right, context)) satisfies boolean;
  }
}

function matchesWhenClause(
  whenAst: KeybindingWhenNode | undefined,
  context: ShortcutMatchContext,
): boolean;
function matchesWhenClause(whenAst: KeybindingWhenNode | undefined, context: ShortcutMatchContext) {
  if (!whenAst) return true satisfies boolean;
  return evaluateWhenNode(whenAst, context) satisfies boolean;
}

function shortcutForContext(binding: ResolvedKeybindingRule, context: ShortcutMatchContext) {
  const shortcut = binding.shortcut;

  if (
    context.composerRequiresModifier &&
    (binding.command === "composer.sendAlternate" ||
      binding.command === "composer.sendBackground") &&
    shortcut.key === "enter" &&
    shortcut.modKey &&
    !shortcut.metaKey &&
    !shortcut.ctrlKey &&
    !shortcut.altKey &&
    !shortcut.shiftKey
  ) {
    return { ...shortcut, shiftKey: true };
  }
  return shortcut;
}

export function effectiveShortcutsForCommand(
  keybindings: ResolvedKeybindingsConfig,
  command: KeybindingCommand,
  options?: ShortcutMatchOptions,
): KeybindingShortcut[];
export function effectiveShortcutsForCommand(
  keybindings: ResolvedKeybindingsConfig,
  command: KeybindingCommand,
  options?: ShortcutMatchOptions,
) {
  const platform = resolvePlatform(options);
  const context = resolveContext(options);
  const claimedShortcuts = new Set<string>();
  const effective: KeybindingShortcut[] = [];

  for (let index = keybindings.length - 1; index >= 0; index -= 1) {
    const binding = keybindings[index];
    if (!binding) continue;
    if (!matchesWhenClause(binding.whenAst, context)) continue;

    const shortcut = shortcutForContext(binding, context);
    const conflictKey = shortcutConflictKey(shortcut, platform);
    if (claimedShortcuts.has(conflictKey)) {
      continue;
    }

    claimedShortcuts.add(conflictKey);
    if (binding.command === command) {
      effective.push(shortcut);
    }
  }

  return effective satisfies KeybindingShortcut[];
}

function findEffectiveShortcutForCommand(
  keybindings: ResolvedKeybindingsConfig,
  command: KeybindingCommand,
  options?: ShortcutMatchOptions,
) {
  return effectiveShortcutsForCommand(keybindings, command, options)[0] ?? null;
}

function matchesCommandShortcut(
  event: ShortcutEventLike,
  keybindings: ResolvedKeybindingsConfig,
  command: KeybindingCommand,
  options?: ShortcutMatchOptions,
) {
  return resolveShortcutCommand(event, keybindings, options) === command;
}

export function resolveShortcutCommand(
  event: ShortcutEventLike,
  keybindings: ResolvedKeybindingsConfig,
  options?: ShortcutMatchOptions,
): KeybindingCommand | null;
export function resolveShortcutCommand(
  event: ShortcutEventLike,
  keybindings: ResolvedKeybindingsConfig,
  options?: ShortcutMatchOptions,
) {
  const platform = resolvePlatform(options);
  const context = resolveContext(options);
  if (options?.context?.editableFocus === undefined && typeof document !== "undefined") {
    context.editableFocus = isEditableFocused(event.target ?? document.activeElement);
  }

  for (let index = keybindings.length - 1; index >= 0; index -= 1) {
    const binding = keybindings[index];
    if (!binding) continue;
    if (!matchesWhenClause(binding.whenAst, context)) continue;
    if (!matchesKeybindingShortcut(event, shortcutForContext(binding, context), platform)) continue;
    return binding.command satisfies KeybindingCommand | null;
  }
  return null satisfies KeybindingCommand | null;
}

export function resolveChatShortcutCommand(
  event: ShortcutEventLike,
  primaryKeybindings: ResolvedKeybindingsConfig,
  activeKeybindings: ResolvedKeybindingsConfig,
  options?: ShortcutMatchOptions,
) {
  const primaryCommand = resolveShortcutCommand(event, primaryKeybindings, options);
  if (primaryCommand !== null && projectScriptIdFromCommand(primaryCommand) === null) {
    return primaryCommand;
  }

  const activeCommand = resolveShortcutCommand(event, activeKeybindings, options);
  return activeCommand !== null && projectScriptIdFromCommand(activeCommand) !== null
    ? activeCommand
    : null;
}

export function formatShortcutKeyLabel(key: string) {
  if (key === " ") return "Space";
  if (key.length === 1) return key.toUpperCase();
  if (key === "escape") return "Esc";
  if (key === "arrowup") return "Up";
  if (key === "arrowdown") return "Down";
  if (key === "arrowleft") return "Left";
  if (key === "arrowright") return "Right";
  if (key === "pageup") return "PageUp";
  if (key === "pagedown") return "PageDown";
  return key.slice(0, 1).toUpperCase() + key.slice(1);
}

export function formatShortcutLabel(shortcut: KeybindingShortcut, platform = navigator.platform) {
  const keyLabel = formatShortcutKeyLabel(shortcut.key);
  const useMetaForMod = isMacPlatform(platform);
  const showMeta = shortcut.metaKey || (shortcut.modKey && useMetaForMod);
  const showCtrl = shortcut.ctrlKey || (shortcut.modKey && !useMetaForMod);
  const showAlt = shortcut.altKey;
  const showShift = shortcut.shiftKey;

  if (useMetaForMod) {
    return `${showCtrl ? "\u2303" : ""}${showAlt ? "\u2325" : ""}${showShift ? "\u21e7" : ""}${showMeta ? "\u2318" : ""}${keyLabel}`;
  }

  const parts: string[] = [];
  if (showCtrl) parts.push("Ctrl");
  if (showAlt) parts.push("Alt");
  if (showShift) parts.push("Shift");
  if (showMeta) parts.push("Meta");
  parts.push(keyLabel);
  return parts.join("+");
}

export function shortcutLabelForCommand(
  keybindings: ResolvedKeybindingsConfig,
  command: KeybindingCommand | null,
  options?: string | ResolvedShortcutLabelOptions,
) {
  if (command === null) return null;
  const resolvedOptions =
    typeof options === "string"
      ? ({ platform: options } satisfies ResolvedShortcutLabelOptions)
      : options;
  const platform = resolvePlatform(resolvedOptions);
  const shortcut = findEffectiveShortcutForCommand(keybindings, command, resolvedOptions);
  return shortcut ? formatShortcutLabel(shortcut, platform) : null;
}

export function threadJumpCommandForIndex(index: number) {
  return THREAD_JUMP_KEYBINDING_COMMANDS[index] ?? null;
}

export function threadJumpIndexFromCommand(command: string) {
  const index = THREAD_JUMP_KEYBINDING_COMMANDS.indexOf(command as ThreadJumpKeybindingCommand);
  return index === -1 ? null : index;
}

export function threadTraversalDirectionFromCommand(command: string | null) {
  if (command === "thread.previous") return "previous";
  if (command === "thread.next") return "next";
  return null;
}

export function isThreadNavigationShortcut(
  event: ShortcutEventLike,
  keybindings: ResolvedKeybindingsConfig,
  options?: ShortcutMatchOptions,
) {
  const command = resolveShortcutCommand(event, keybindings, options);
  return (
    threadTraversalDirectionFromCommand(command) !== null ||
    threadJumpIndexFromCommand(command ?? "") !== null
  );
}

export function shouldShowThreadJumpHintsForModifiers(
  modifiers: ShortcutModifierStateLike,
  keybindings: ResolvedKeybindingsConfig,
  options?: ShortcutMatchOptions,
) {
  if (resolveContext(options).terminalFocus) {
    return false;
  }

  const platform = resolvePlatform(options);

  for (const command of THREAD_JUMP_KEYBINDING_COMMANDS) {
    const shortcut = findEffectiveShortcutForCommand(keybindings, command, options);
    if (!shortcut) continue;
    if (matchesKeybindingShortcutModifiers(modifiers, shortcut, platform)) {
      return true;
    }
  }

  return false;
}

export function modelPickerJumpCommandForIndex(index: number) {
  return MODEL_PICKER_JUMP_KEYBINDING_COMMANDS[index] ?? null;
}

export function modelPickerJumpIndexFromCommand(command: string) {
  const index = MODEL_PICKER_JUMP_KEYBINDING_COMMANDS.indexOf(
    command as ModelPickerJumpKeybindingCommand,
  );
  return index === -1 ? null : index;
}

export function isTerminalToggleShortcut(
  event: ShortcutEventLike,
  keybindings: ResolvedKeybindingsConfig,
  options?: ShortcutMatchOptions,
) {
  return matchesCommandShortcut(event, keybindings, "terminal.toggle", options);
}

export function isTerminalSplitShortcut(
  event: ShortcutEventLike,
  keybindings: ResolvedKeybindingsConfig,
  options?: ShortcutMatchOptions,
) {
  return matchesCommandShortcut(event, keybindings, "terminal.split", options);
}

export function isTerminalSplitVerticalShortcut(
  event: ShortcutEventLike,
  keybindings: ResolvedKeybindingsConfig,
  options?: ShortcutMatchOptions,
) {
  return matchesCommandShortcut(event, keybindings, "terminal.splitVertical", options);
}

export function isTerminalNewShortcut(
  event: ShortcutEventLike,
  keybindings: ResolvedKeybindingsConfig,
  options?: ShortcutMatchOptions,
) {
  return matchesCommandShortcut(event, keybindings, "terminal.new", options);
}

export function isTerminalCloseShortcut(
  event: ShortcutEventLike,
  keybindings: ResolvedKeybindingsConfig,
  options?: ShortcutMatchOptions,
) {
  return matchesCommandShortcut(event, keybindings, "terminal.close", options);
}

export function isDiffToggleShortcut(
  event: ShortcutEventLike,
  keybindings: ResolvedKeybindingsConfig,
  options?: ShortcutMatchOptions,
) {
  return matchesCommandShortcut(event, keybindings, "diff.toggle", options);
}

/**
 * Whether the keypress should bold text in the rich-text composer: Mod+B
 * without extra modifiers, with text selected. Tiptap binds the same chord, so
 * app shortcuts captured ahead of the editor yield only in that case. With no
 * selection an app binding on the chord wins (the sidebar toggle by default).
 */
export function isRichTextBoldShortcut(
  event: ShortcutEventLike,
  selection: Pick<Selection, "isCollapsed"> | null,
) {
  if (event.type !== undefined && event.type !== "keydown") {
    return false;
  }
  return (
    selection !== null &&
    !selection.isCollapsed &&
    resolveEventKeys(event).has("b") &&
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    !event.shiftKey
  );
}

/** Mod+B, Mod+I and Mod+E, the mark chords the rich-text composer binds. */
export function isRichTextFormattingShortcut(event: ShortcutEventLike) {
  if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return false;
  const keys = resolveEventKeys(event);
  return keys.has("b") || keys.has("i") || keys.has("e");
}

export function isTerminalClearShortcut(event: ShortcutEventLike, platform = navigator.platform) {
  if (event.type !== undefined && event.type !== "keydown") {
    return false;
  }

  const key = event.key.toLowerCase();

  if (key === "l" && event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
    return true;
  }

  return (
    isMacPlatform(platform) &&
    key === "k" &&
    event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.shiftKey
  );
}

export function terminalDeleteShortcutData(
  event: ShortcutEventLike,
  platform = navigator.platform,
) {
  if (event.type !== undefined && event.type !== "keydown") {
    return null;
  }

  if (!isMacPlatform(platform)) {
    return null;
  }

  const key = normalizeEventKey(event.key);
  if (key !== "backspace") {
    return null;
  }

  return event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey
    ? TERMINAL_DELETE_TO_LINE_START
    : null;
}

export function terminalNavigationShortcutData(
  event: ShortcutEventLike,
  platform = navigator.platform,
) {
  if (event.type !== undefined && event.type !== "keydown") {
    return null;
  }

  if (event.shiftKey) return null;

  const key = normalizeEventKey(event.key);
  if (key !== "arrowleft" && key !== "arrowright") {
    return null;
  }

  const moveWord = key === "arrowleft" ? TERMINAL_WORD_BACKWARD : TERMINAL_WORD_FORWARD;
  const moveLine = key === "arrowleft" ? TERMINAL_LINE_START : TERMINAL_LINE_END;

  if (isMacPlatform(platform)) {
    if (event.altKey && !event.metaKey && !event.ctrlKey) {
      return moveWord;
    }
    if (event.metaKey && !event.altKey && !event.ctrlKey) {
      return moveLine;
    }
    return null;
  }

  if (event.altKey && !event.metaKey && !event.ctrlKey) {
    return moveWord;
  }

  return null;
}
