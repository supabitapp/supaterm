import {
  BRANCH_PICKER_JUMP_KEYBINDING_COMMANDS,
  HOST_PICKER_JUMP_KEYBINDING_COMMANDS,
  PROJECT_PICKER_JUMP_KEYBINDING_COMMANDS,
  type KeybindingCommand,
  type ResolvedKeybindingsConfig,
} from "@supaterm/contracts";
import { useEffect, useEffectEvent } from "react";

import { isCommandPaletteOpen } from "~/commandPaletteBus";
import { resolveShortcutCommand, shortcutLabelForCommand } from "~/keybindings";

const PICKER_COMMANDS = {
  project: PROJECT_PICKER_JUMP_KEYBINDING_COMMANDS,
  host: HOST_PICKER_JUMP_KEYBINDING_COMMANDS,
  branch: BRANCH_PICKER_JUMP_KEYBINDING_COMMANDS,
};

/** Number visible choices, with an optional fixed shortcut for a special choice. */
export function usePickerShortcuts<T>({
  picker,
  open,
  items,
  fixedChoice,
  keybindings,
  onSelect,
}: {
  picker: keyof typeof PICKER_COMMANDS;
  open: boolean;
  items: readonly T[];
  fixedChoice?: { item: T; command: KeybindingCommand } | undefined;
  keybindings: ResolvedKeybindingsConfig;
  onSelect: (item: T) => void;
}) {
  const commands = PICKER_COMMANDS[picker];
  const context = {
    modelPickerOpen: false,
    projectPickerOpen: picker === "project",
    hostPickerOpen: picker === "host",
    branchPickerOpen: picker === "branch",
  };
  const labels = new Map<T, string>();
  if (open) {
    if (fixedChoice) {
      const label = shortcutLabelForCommand(keybindings, fixedChoice.command, { context });
      if (label) labels.set(fixedChoice.item, label);
    }
    for (const [index, item] of items.entries()) {
      const command = commands[index];
      if (!command) break;
      const label = shortcutLabelForCommand(keybindings, command, {
        context,
      });
      if (label) labels.set(item, label);
    }
  }

  const handleKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.repeat || event.isComposing || isCommandPaletteOpen()) {
      return;
    }
    const command = resolveShortcutCommand(event, keybindings, {
      context,
    });
    if (fixedChoice && command === fixedChoice.command) {
      event.preventDefault();
      event.stopPropagation();
      onSelect(fixedChoice.item);
      return;
    }
    const index = commands.findIndex((candidate) => candidate === command);
    if (index === -1) return;
    // Even an empty slot belongs to the picker; it must not jump to a sidebar thread.
    event.preventDefault();
    event.stopPropagation();
    const item = items[index];
    if (item !== undefined) onSelect(item);
  });

  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- Registers window keyboard shortcuts only while the picker is open.
  useEffect(() => {
    if (!open) return;
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [open]);

  return labels;
}
