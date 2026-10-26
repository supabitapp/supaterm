import type { KeybindingCommand, ResolvedKeybindingsConfig } from "@supaterm/contracts";
import { useEffect, useEffectEvent } from "react";
import { registerAppCommandHandler } from "../../appCommandBus";
import { isCommandPaletteOpen } from "../../commandPaletteBus";
import { resolveChatShortcutCommand, type ShortcutMatchContext } from "../../keybindings";
import { isTerminalCloseConfirmPending } from "../../lib/terminalCloseConfirm";
import {
  preventRepeatedTerminalCloseShortcut,
  preventTerminalCloseShortcut,
} from "../../lib/terminalCloseShortcut";
import { getTerminalFocusOwner, type TerminalFocusOwner } from "../../lib/terminalFocus";
import type { ComposerHandleRef } from "../../composerHandleContext";
import type { BranchToolbarHandle } from "../BranchToolbar";
import { shouldTypeToFocusComposer } from "./composerFocusRedirect";
import { composerShortcutCommands, type ComposerShortcutAvailability } from "./composerShortcuts";

/**
 * Runs a command. Returning false lets the key event through untouched. App commands
 * dispatched without a key event run with `repeat: false`.
 */
export type ChatShortcutHandler = (context: {
  readonly repeat: boolean;
  readonly terminalFocusOwner: TerminalFocusOwner | null;
}) => boolean | void;

export type ChatShortcutCommands = Partial<Record<KeybindingCommand, ChatShortcutHandler>>;

export interface ChatShortcutsInput {
  readonly enabled: boolean;
  /** Whether this chat's pane receives window input; only one pane in a split does. */
  readonly isInputOwner: () => boolean;
  readonly keybindings: ResolvedKeybindingsConfig;
  readonly scriptKeybindings: ResolvedKeybindingsConfig;
  readonly getShortcutContext: (target: EventTarget | null) => ShortcutMatchContext & {
    readonly modelPickerOpen: boolean;
  };
  readonly threadFindActive: boolean;
  /** Takes type-to-focus keys and the composer and branch toolbar chords. */
  readonly composerRef: ComposerHandleRef;
  readonly branchToolbarRef: { readonly current: BranchToolbarHandle | null };
  readonly composerShortcutAvailability: ComposerShortcutAvailability;
  readonly closeThreadFind: () => void;
  readonly commands: ChatShortcutCommands;
  /** Handles commands not in `commands`, such as project scripts. */
  readonly fallback: (command: KeybindingCommand) => ChatShortcutHandler | undefined;
}

/**
 * The chat's window keyboard shortcuts and dispatched app commands, plus Escape
 * closing thread find. Listeners attach once; the effect events read the latest
 * input, so handlers act on the current render without re-registering on every change.
 */
export function useChatShortcuts(input: ChatShortcutsInput) {
  const resolveHandler = (command: KeybindingCommand) =>
    input.commands[command] ??
    composerShortcutCommands(
      input.composerRef,
      input.branchToolbarRef,
      input.composerShortcutAvailability,
    )[command] ??
    input.fallback(command);
  const handleShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (!input.isInputOwner()) return;
    const { keybindings } = input;
    if (preventRepeatedTerminalCloseShortcut(event, keybindings)) {
      event.stopPropagation();
      return;
    }
    if (input.threadFindActive && event.key === "Escape") return;
    if (isTerminalCloseConfirmPending() && preventTerminalCloseShortcut(event, keybindings)) {
      event.stopPropagation();
      return;
    }
    if (!input.enabled || isCommandPaletteOpen()) return;
    const terminalFocusOwner = getTerminalFocusOwner();
    if (event.defaultPrevented && terminalFocusOwner === null) return;
    const shortcutContext = input.getShortcutContext(event.target);

    if (
      !shortcutContext.terminalFocus &&
      !shortcutContext.modelPickerOpen &&
      shouldTypeToFocusComposer(event) &&
      input.composerRef.current?.insertTextAtEnd(event.key) === true
    ) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    const command = resolveChatShortcutCommand(event, keybindings, input.scriptKeybindings, {
      context: shortcutContext,
    });
    if (!command) return;
    const run = resolveHandler(command);
    if (!run || run({ repeat: event.repeat, terminalFocusOwner }) === false) return;
    event.preventDefault();
    event.stopPropagation();
  });
  const dismissFind = useEffectEvent((event: KeyboardEvent) => {
    if (
      !input.isInputOwner() ||
      event.key !== "Escape" ||
      !input.threadFindActive ||
      event.defaultPrevented ||
      event.isComposing ||
      event.keyCode === 229 ||
      isCommandPaletteOpen()
    )
      return;
    const context = input.getShortcutContext(event.target);
    if (context.terminalFocus || context.previewFocus || context.modelPickerOpen) return;
    event.preventDefault();
    input.closeThreadFind();
  });
  const handleAppCommand = useEffectEvent((command: KeybindingCommand) => {
    if (!input.isInputOwner() || !input.enabled || isCommandPaletteOpen()) return false;
    const run = resolveHandler(command);
    if (!run) return false;
    return run({ repeat: false, terminalFocusOwner: getTerminalFocusOwner() }) !== false;
  });
  useEffect(() => {
    const onKeyDownCapture = (event: KeyboardEvent) => handleShortcut(event);
    const onKeyDown = (event: KeyboardEvent) => dismissFind(event);
    const unregister = registerAppCommandHandler((command) => handleAppCommand(command));
    window.addEventListener("keydown", onKeyDownCapture, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      unregister();
      window.removeEventListener("keydown", onKeyDownCapture, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);
}
