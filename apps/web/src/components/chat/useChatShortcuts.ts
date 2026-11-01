import type { KeybindingCommand, ResolvedKeybindingsConfig } from "@supaterm/contracts";
import { useEffect, useEffectEvent } from "react";
import { isCommandPaletteOpen } from "../../commandPaletteBus";
import type { ShortcutMatchContext } from "../../keybindings";
import { isTerminalCloseConfirmPending } from "../../lib/terminalCloseConfirm";
import {
  preventRepeatedTerminalCloseShortcut,
  preventTerminalCloseShortcut,
} from "../../lib/terminalCloseShortcut";
import { getTerminalFocusOwner, type TerminalFocusOwner } from "../../lib/terminalFocus";
import type { ComposerHandleRef } from "../../composerHandleContext";
import { type CommandInvocation, registerCommands } from "../../shortcuts/dispatcher";
import type { BranchToolbarHandle } from "../BranchToolbar";
import { shouldTypeToFocusComposer } from "./composerFocusRedirect";
import { composerShortcutCommands, type ComposerShortcutAvailability } from "./composerShortcuts";

/**
 * Runs a command. Returning false lets the key event through untouched. Menu and
 * device commands run with `repeat: false`.
 */
export type ChatShortcutHandler = (context: {
  readonly repeat: boolean;
  /** The key press behind the command; null for menus and devices. */
  readonly event: KeyboardEvent | null;
  readonly terminalFocusOwner: TerminalFocusOwner | null;
}) => boolean | void;

export type ChatShortcutCommands = Partial<Record<KeybindingCommand, ChatShortcutHandler>>;

interface ChatShortcutsInput {
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
 * The chat's commands, for keys, desktop menus and devices, plus Escape closing
 * thread find. The scopes register once; their effect events read the latest
 * input, so commands act on the current render without re-registering.
 */
export function useChatShortcuts(input: ChatShortcutsInput) {
  const isLive = useEffectEvent(
    () => input.isInputOwner() && input.enabled && !isCommandPaletteOpen(),
  );
  const isInputOwner = useEffectEvent(() => input.isInputOwner());
  const guardTerminalClose = useEffectEvent((event: KeyboardEvent) => {
    const { keybindings } = input;
    if (preventRepeatedTerminalCloseShortcut(event, keybindings)) {
      event.stopPropagation();
      return true;
    }
    if (isTerminalCloseConfirmPending() && preventTerminalCloseShortcut(event, keybindings)) {
      event.stopPropagation();
      return true;
    }
    return false;
  });
  const typeToFocusComposer = useEffectEvent((event: KeyboardEvent) => {
    const context = input.getShortcutContext(event.target);
    if (
      context.terminalFocus ||
      context.modelPickerOpen ||
      !shouldTypeToFocusComposer(event) ||
      input.composerRef.current?.insertTextAtEnd(event.key) !== true
    ) {
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    return true;
  });
  const runCommand = useEffectEvent((command: KeybindingCommand, invocation: CommandInvocation) => {
    // Escape belongs to thread find while it is open, whatever else it is bound to.
    if (input.threadFindActive && invocation.event?.key === "Escape") return false;
    const run =
      input.commands[command] ??
      composerShortcutCommands(
        input.composerRef,
        input.branchToolbarRef,
        input.composerShortcutAvailability,
      )[command] ??
      input.fallback(command);
    return run
      ? run({
          repeat: invocation.repeat,
          event: invocation.event,
          terminalFocusOwner: getTerminalFocusOwner(),
        })
      : false;
  });
  const readShortcutContext = useEffectEvent((event: KeyboardEvent) =>
    input.getShortcutContext(event.target),
  );
  const readKeybindings = useEffectEvent(() => input.keybindings);
  const readScriptKeybindings = useEffectEvent(() => input.scriptKeybindings);
  const dismissFind = useEffectEvent((event: KeyboardEvent) => {
    if (
      event.key !== "Escape" ||
      !input.threadFindActive ||
      event.isComposing ||
      event.keyCode === 229 ||
      isCommandPaletteOpen()
    )
      return false;
    const context = input.getShortcutContext(event.target);
    if (context.terminalFocus || context.previewFocus || context.modelPickerOpen) return false;
    event.preventDefault();
    input.closeThreadFind();
  });
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- registers the chat's command scopes with the dispatcher for the component's lifetime
  useEffect(() => {
    // The newest scope runs first, so the terminal-close guard goes ahead of the commands.
    const disposers = [
      registerCommands((command, invocation) => runCommand(command, invocation), {
        capture: true,
        when: () => isLive(),
        context: (event) => readShortcutContext(event),
        keybindings: () => readKeybindings(),
        scriptKeybindings: () => readScriptKeybindings(),
        onKeyDown: (event) => typeToFocusComposer(event),
      }),
      registerCommands(
        {},
        {
          capture: true,
          when: () => isInputOwner(),
          onKeyDown: (event) => guardTerminalClose(event),
        },
      ),
      registerCommands(
        {},
        { when: () => isInputOwner(), onKeyDown: (event) => dismissFind(event) },
      ),
    ];
    return () => {
      for (const dispose of disposers) dispose();
    };
  }, []);
}
