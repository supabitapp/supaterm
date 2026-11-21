import { THREAD_JUMP_KEYBINDING_COMMANDS } from "@supaterm/contracts";
import { useSyncExternalStore } from "react";

import type { SidebarRow } from "../Sidebar.logic";

let targets: ReadonlyArray<SidebarRow> = [];
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function publishThreadJumpTargets(orderedRows: ReadonlyArray<SidebarRow>): void {
  const next = orderedRows.slice(0, THREAD_JUMP_KEYBINDING_COMMANDS.length);
  if (next.length === targets.length && next.every((row, index) => row.key === targets[index]?.key))
    return;
  targets = next;
  for (const listener of listeners) listener();
}

/** The rows the jump shortcuts open, in shortcut order, as the sidebar last rendered them. */
export function useThreadJumpTargets(): ReadonlyArray<SidebarRow> {
  return useSyncExternalStore(subscribe, () => targets);
}
