import type { KeybindingCommand, ResolvedKeybindingsConfig } from "@supaterm/contracts";
import { registerAppCommandHandler } from "../appCommandBus";

import { resolveShortcutCommand, type ShortcutMatchContext } from "../keybindings";
import { isEditableFocused } from "../lib/editableFocus";
import { isPreviewFocused } from "../lib/previewFocus";
import { isTerminalFocused } from "../lib/terminalFocus";
import { isModelPickerOpen } from "../modelPickerVisibility";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { primaryServerKeybindingsAtom } from "../state/server";

export type CommandHandler = (event: KeyboardEvent) => boolean | void;

export type CommandHandlers = Partial<Record<KeybindingCommand, CommandHandler>>;

export interface CommandScopeOptions {
  readonly when?: (event: KeyboardEvent) => boolean;
  readonly context?: () => Partial<ShortcutMatchContext>;
  readonly keybindings?: () => ResolvedKeybindingsConfig;
  readonly onKeyDown?: CommandHandler;
  readonly capture?: boolean;
  readonly observe?: (event: KeyboardEvent, consumed: boolean) => void;
}

interface CommandScope {
  readonly commands: CommandHandlers;
  readonly options: CommandScopeOptions;
}

const globalScopes: CommandScope[] = [];
const captureScopes: CommandScope[] = [];
const observerScopes: CommandScope[] = [];

function readFocusContext(event: KeyboardEvent): Partial<ShortcutMatchContext> {
  return {
    terminalFocus: isTerminalFocused(),
    previewFocus: isPreviewFocused(),
    editableFocus: isEditableFocused(event.target),
    modelPickerOpen: isModelPickerOpen(),
  };
}

function runScope(scope: CommandScope, event: KeyboardEvent): boolean {
  const { commands, options } = scope;
  if (options.when && !options.when(event)) return false;
  if (options.onKeyDown && options.onKeyDown(event) !== false) return true;
  const command = resolveShortcutCommand(
    event,
    options.keybindings?.() ?? appAtomRegistry.get(primaryServerKeybindingsAtom),
    { context: { ...readFocusContext(event), ...options.context?.() } },
  );
  const handler = command === null ? undefined : commands[command];
  return handler !== undefined && handler(event) !== false;
}

function runScopes(scopes: readonly CommandScope[], event: KeyboardEvent): boolean {
  for (let index = scopes.length - 1; index >= 0; index -= 1) {
    if (event.defaultPrevented) return true;
    const scope = scopes[index];
    if (scope && runScope(scope, event)) return true;
  }
  return false;
}

function dispatchCaptureKeyDown(event: KeyboardEvent): void {
  runScopes(captureScopes, event);
}

function dispatchKeyDown(event: KeyboardEvent): void {
  const consumed = runScopes(globalScopes, event) || event.defaultPrevented;
  for (const scope of observerScopes.slice()) scope.options.observe?.(event, consumed);
}

let keydownInstalled = false;
function ensureKeydownListener() {
  if (keydownInstalled || typeof window === "undefined") return;
  keydownInstalled = true;
  window.addEventListener("keydown", dispatchCaptureKeyDown, true);
  window.addEventListener("keydown", dispatchKeyDown);
}

function pushScope(list: CommandScope[], scope: CommandScope): () => void {
  ensureKeydownListener();
  list.push(scope);
  return () => {
    const index = list.lastIndexOf(scope);
    if (index !== -1) list.splice(index, 1);
  };
}

export function registerCommands(
  commands: CommandHandlers,
  options: CommandScopeOptions = {},
): () => void {
  const scopes = options.observe ? observerScopes : options.capture ? captureScopes : globalScopes;
  const removeScope = pushScope(scopes, { commands, options });
  const removeCommandHandler = registerAppCommandHandler((command) => {
    const handler = commands[command];
    if (!handler || typeof KeyboardEvent === "undefined") return false;
    const event = new KeyboardEvent("keydown", { cancelable: true });
    if (options.when && !options.when(event)) return false;
    return handler(event) !== false;
  });
  return () => {
    removeScope();
    removeCommandHandler();
  };
}

type MenuActionHandler = () => void;
const menuActionHandlers = new Map<string, MenuActionHandler[]>();
let menuActionInstalled = false;

export function dispatchMenuAction(action: string): void {
  const handlers = menuActionHandlers.get(action);
  handlers?.at(-1)?.();
}

function ensureMenuActionListener() {
  if (menuActionInstalled || typeof window === "undefined") return;
  const bridge = window.desktopBridge;
  if (typeof bridge?.onMenuAction !== "function") return;
  menuActionInstalled = true;
  bridge.onMenuAction(dispatchMenuAction);
}

export function registerMenuAction(action: string, handler: MenuActionHandler): () => void {
  ensureMenuActionListener();
  const handlers = menuActionHandlers.get(action) ?? [];
  handlers.push(handler);
  menuActionHandlers.set(action, handlers);
  return () => {
    const index = handlers.lastIndexOf(handler);
    if (index !== -1) handlers.splice(index, 1);
  };
}
