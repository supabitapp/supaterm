import { THREAD_JUMP_KEYBINDING_COMMANDS } from "@supaterm/contracts";
import { useSyncExternalStore } from "react";

let targets: ReadonlyArray<string> = [];
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function publishThreadJumpTargets(orderedThreadKeys: ReadonlyArray<string>): void {
  const next = orderedThreadKeys.slice(0, THREAD_JUMP_KEYBINDING_COMMANDS.length);
  if (next.length === targets.length && next.every((key, index) => key === targets[index])) return;
  targets = next;
  for (const listener of listeners) listener();
}

/** The thread keys the jump shortcuts open, in shortcut order, as the sidebar last rendered them. */
export function useThreadJumpTargets(): ReadonlyArray<string> {
  return useSyncExternalStore(subscribe, () => targets);
}
