import type { KeybindingCommand } from "@supaterm/contracts";

/** Returns true when it ran the command. */
export type AppCommandHandler = (command: KeybindingCommand) => boolean;

const handlers: AppCommandHandler[] = [];

/**
 * Runs a command without a key press, for input that is not a keyboard
 * shortcut. The most recently registered handler that accepts it wins.
 */
export function dispatchAppCommand(command: KeybindingCommand): boolean {
  return handlers.toReversed().some((handler) => handler(command));
}

export function registerAppCommandHandler(handler: AppCommandHandler): () => void {
  handlers.push(handler);
  return () => {
    const index = handlers.indexOf(handler);
    if (index !== -1) handlers.splice(index, 1);
  };
}
