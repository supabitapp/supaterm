import { KeybindingCommand, type ResolvedKeybindingsConfig } from "@supaterm/contracts";
import * as Schema from "effect/Schema";

import {
  resolveChatShortcutCommand,
  resolveShortcutCommand,
  type ShortcutMatchContext,
} from "../keybindings";
import { isEditableFocused } from "../lib/editableFocus";
import { isPreviewFocused } from "../lib/previewFocus";
import { isTerminalFocused } from "../lib/terminalFocus";
import { isModelPickerOpen } from "../modelPickerVisibility";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { primaryServerKeybindingsAtom } from "../state/server";

export interface CommandInvocation {
  /** `menu` includes keys a focused desktop browser forwards; `device` is hardware like Codex Micro. */
  readonly source: "keyboard" | "menu" | "device";
  /** The key press behind a keyboard command. */
  readonly event: KeyboardEvent | null;
  readonly repeat: boolean;
}

/** Return `false` to let the next scope have the command; a key that ran one is consumed. */
export type CommandHandler = (invocation: CommandInvocation) => boolean | void;

export type CommandHandlers = Partial<Record<KeybindingCommand, CommandHandler>>;

/** Runs any command a scope owns, returning `false` for the rest; for sets that change, such as project scripts. */
type CommandRunner = (command: KeybindingCommand, invocation: CommandInvocation) => boolean | void;

export interface CommandScopeOptions {
  /** Read when a key or command arrives; a scope whose guard fails is skipped. */
  readonly when?: () => boolean;
  /** When-clause context the dispatcher cannot know (terminalOpen, previewOpen), read at event time. */
  readonly context?: (event: KeyboardEvent) => Partial<ShortcutMatchContext>;
  readonly keybindings?: () => ResolvedKeybindingsConfig;
  /** Project script bindings; a key resolves to a script command only through these. */
  readonly scriptKeybindings?: () => ResolvedKeybindingsConfig;
  /**
   * For keys that are not keybinding commands (Escape, "/"); runs before command lookup.
   * Return `false` to let the scope look the key up as a command.
   */
  readonly onKeyDown?: (event: KeyboardEvent) => boolean | void;
  /**
   * Run in the capture phase, ahead of focused widgets that consume the key
   * themselves (the terminal encodes Ctrl+Shift+T and stops propagation).
   */
  readonly capture?: boolean;
}

interface CommandScope {
  readonly run: CommandRunner;
  readonly options: CommandScopeOptions;
}

type KeyObserver = (event: KeyboardEvent, consumed: boolean) => void;

// Within each list the newest scope wins.
const globalScopes: CommandScope[] = [];
const captureScopes: CommandScope[] = [];
const observerScopes: KeyObserver[] = [];

const isKeybindingCommand = Schema.is(KeybindingCommand);

function readFocusContext(event: KeyboardEvent): Partial<ShortcutMatchContext> {
  return {
    terminalFocus: isTerminalFocused(),
    previewFocus: isPreviewFocused(),
    editableFocus: isEditableFocused(event.target),
    modelPickerOpen: isModelPickerOpen(),
  };
}

function isLive(scope: CommandScope): boolean {
  return scope.options.when?.() ?? true;
}

function resolveKeyCommand(scope: CommandScope, event: KeyboardEvent): KeybindingCommand | null {
  const { options } = scope;
  const keybindings = options.keybindings?.() ?? appAtomRegistry.get(primaryServerKeybindingsAtom);
  const match = { context: { ...readFocusContext(event), ...options.context?.(event) } };
  return options.scriptKeybindings
    ? resolveChatShortcutCommand(event, keybindings, options.scriptKeybindings(), match)
    : resolveShortcutCommand(event, keybindings, match);
}

function isInsideConfirmation(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[role="alertdialog"]') !== null;
}

function runKeyScope(scope: CommandScope, event: KeyboardEvent): boolean {
  if (!isLive(scope)) return false;
  if (scope.options.onKeyDown && scope.options.onKeyDown(event) !== false) return true;
  const command = resolveKeyCommand(scope, event);
  if (command === null) return false;
  if (isInsideConfirmation(event.target)) {
    event.preventDefault();
    return true;
  }
  if (scope.run(command, { source: "keyboard", event, repeat: event.repeat }) === false) {
    return false;
  }
  event.preventDefault();
  event.stopPropagation();
  return true;
}

// Keys typed into a shortcut recorder are being recorded, not run.
function isKeybindingCaptureTarget(event: KeyboardEvent): boolean {
  return (
    event.target instanceof Element && event.target.closest("[data-keybinding-capture]") !== null
  );
}

function runKeyScopes(scopes: readonly CommandScope[], event: KeyboardEvent): boolean {
  if (isKeybindingCaptureTarget(event)) return false;
  for (let index = scopes.length - 1; index >= 0; index -= 1) {
    if (event.defaultPrevented) return true;
    const scope = scopes[index];
    if (scope && runKeyScope(scope, event)) return true;
  }
  return false;
}

/**
 * Runs a command without a key press, for menu and device input. Capture
 * scopes go first, as they would for the key. Returns whether a scope ran it.
 */
export function runCommand(
  command: KeybindingCommand,
  source: Exclude<CommandInvocation["source"], "keyboard">,
): boolean {
  for (const scopes of [captureScopes, globalScopes]) {
    for (let index = scopes.length - 1; index >= 0; index -= 1) {
      const scope = scopes[index];
      if (!scope || !isLive(scope)) continue;
      if (scope.run(command, { source, event: null, repeat: false }) !== false) return true;
    }
  }
  return false;
}

function dispatchCaptureKeyDown(event: KeyboardEvent): void {
  runKeyScopes(captureScopes, event);
}

function dispatchKeyDown(event: KeyboardEvent): void {
  const consumed = runKeyScopes(globalScopes, event) || event.defaultPrevented;
  for (const observe of observerScopes.slice()) observe(event, consumed);
}

type MenuActionHandler = () => void;
const menuActionHandlers = new Map<string, MenuActionHandler[]>();

/** Desktop menu actions; one named after a keybinding command runs that command. */
export function dispatchMenuAction(action: string): void {
  const handler = menuActionHandlers.get(action)?.at(-1);
  if (handler) handler();
  else if (isKeybindingCommand(action)) runCommand(action, "menu");
}

let keydownInstalled = false;
let menuActionInstalled = false;
function ensureListeners() {
  if (typeof window === "undefined") return;
  if (!keydownInstalled) {
    keydownInstalled = true;
    window.addEventListener("keydown", dispatchCaptureKeyDown, true);
    window.addEventListener("keydown", dispatchKeyDown);
  }
  const bridge = window.desktopBridge;
  if (menuActionInstalled || typeof bridge?.onMenuAction !== "function") return;
  menuActionInstalled = true;
  bridge.onMenuAction(dispatchMenuAction);
}

function pushScope<T>(list: T[], scope: T): () => void {
  ensureListeners();
  list.push(scope);
  return () => {
    const index = list.lastIndexOf(scope);
    if (index !== -1) list.splice(index, 1);
  };
}

/** Commands for keys, menus and devices; the handlers and their guard are registered once. */
export function registerCommands(
  commands: CommandHandlers | CommandRunner,
  options: CommandScopeOptions = {},
): () => void {
  const scopes = options.capture ? captureScopes : globalScopes;
  const run: CommandRunner =
    typeof commands === "function"
      ? commands
      : (command, invocation) => {
          const handler = commands[command];
          return handler ? handler(invocation) : false;
        };
  return pushScope(scopes, { run, options });
}

/**
 * Hears every bubbling keydown after the scopes ran, with whether one of them (or the page)
 * consumed it, and never consumes it. For listeners that react to keys other scopes may also
 * handle, such as scroll keys.
 */
export function observeKeyDown(observe: KeyObserver): () => void {
  return pushScope(observerScopes, observe);
}

/** Desktop menu actions that are not keybinding commands; the newest handler for an action wins. */
export function registerMenuAction(action: string, handler: MenuActionHandler): () => void {
  const handlers = menuActionHandlers.get(action) ?? [];
  menuActionHandlers.set(action, handlers);
  return pushScope(handlers, handler);
}
