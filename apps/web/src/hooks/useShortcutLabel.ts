import { useAtomValue } from "@effect/atom-react";
import type { KeybindingCommand } from "@supaterm/contracts";

import { shortcutLabelForCommand, type ResolvedShortcutLabelOptions } from "../keybindings";
import { primaryServerKeybindingsAtom } from "../state/server";

/** The effective shortcut for a command, formatted for display, or null while it is unbound. */
export function useShortcutLabel(
  command: KeybindingCommand | null,
  options?: ResolvedShortcutLabelOptions,
): string | null {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  return shortcutLabelForCommand(keybindings, command, options);
}
