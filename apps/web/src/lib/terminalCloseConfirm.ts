import { ensureClientSettingsHydrated, getClientSettings } from "~/hooks/useSettings";
import { readLocalApi } from "~/localApi";

let pendingConfirmations = 0;

export interface CloseConfirmationHost {
  readonly dialogs: () =>
    | {
        readonly confirm: (
          message: string,
          options: { readonly variant: "destructive" },
        ) => Promise<boolean>;
      }
    | undefined;
  readonly hydrateSettings: () => Promise<unknown>;
  readonly confirmTerminalCloseEnabled: () => boolean;
}

const appCloseConfirmationHost: CloseConfirmationHost = {
  dialogs: () => readLocalApi()?.dialogs,
  hydrateSettings: ensureClientSettingsHydrated,
  confirmTerminalCloseEnabled: () => getClientSettings().confirmTerminalClose,
};

export interface TerminalCloseTarget {
  readonly label: string;
  readonly hasRunningSubprocess: boolean;
}

/** Whether a terminal-close action is waiting on settings or user confirmation. */
export function isTerminalCloseConfirmPending(): boolean {
  return pendingConfirmations > 0;
}

export async function confirmClose(
  message: string,
  host: CloseConfirmationHost = appCloseConfirmationHost,
) {
  const dialogs = host.dialogs();
  if (!dialogs) return true;
  pendingConfirmations += 1;
  try {
    return await dialogs.confirm(message, { variant: "destructive" });
  } catch {
    return false;
  } finally {
    pendingConfirmations -= 1;
  }
}

async function terminalCloseConfirmationEnabled(host: CloseConfirmationHost): Promise<boolean> {
  pendingConfirmations += 1;
  try {
    await host.hydrateSettings();
    return host.confirmTerminalCloseEnabled();
  } catch {
    return true;
  } finally {
    pendingConfirmations -= 1;
  }
}

/**
 * Confirmation for terminal close actions: drawer buttons, panel buttons, the
 * `terminal.close` keybinding, and closing terminal surfaces from the tab strip,
 * one at a time or in bulk. Auto-exit cleanup skips this path and closes
 * directly.
 */
export async function confirmTerminalClose(
  targets: readonly TerminalCloseTarget[],
  host: CloseConfirmationHost = appCloseConfirmationHost,
): Promise<boolean> {
  const runningTargets = targets.filter((target) => target.hasRunningSubprocess);
  if (runningTargets.length === 0) return true;
  if (!(await terminalCloseConfirmationEnabled(host))) return true;

  return confirmClose(
    runningTargets.length === 1
      ? [
          `Close terminal "${runningTargets[0]!.label}"?`,
          "This stops the running process and clears its history.",
        ].join("\n")
      : [
          `Close ${runningTargets.length} terminals?`,
          `This stops their running processes and clears their histories: ${runningTargets
            .map((target) => `"${target.label}"`)
            .join(", ")}.`,
        ].join("\n"),
    host,
  );
}
