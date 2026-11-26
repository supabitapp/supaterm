import { ensureClientSettingsHydrated, getClientSettings } from "~/hooks/useSettings";
import { readLocalApi } from "~/localApi";
import { msg } from "gt-react";
import { m } from "~/i18n/messages";

let pendingConfirmations = 0;

export interface TerminalCloseTarget {
  readonly label: string;
  readonly hasRunningSubprocess: boolean;
}

/** Whether a terminal-close action is waiting on settings or user confirmation. */
export function isTerminalCloseConfirmPending(): boolean {
  return pendingConfirmations > 0;
}

export async function confirmClose(message: string) {
  const localApi = readLocalApi();
  if (!localApi) return true;
  pendingConfirmations += 1;
  try {
    return await localApi.dialogs.confirm(message, { variant: "destructive" });
  } catch {
    return false;
  } finally {
    pendingConfirmations -= 1;
  }
}

async function terminalCloseConfirmationEnabled(): Promise<boolean> {
  pendingConfirmations += 1;
  try {
    await ensureClientSettingsHydrated();
    return getClientSettings().confirmTerminalClose;
  } catch {
    // If saved settings cannot be read, keep the destructive confirmation.
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
): Promise<boolean> {
  const runningTargets = targets.filter((target) => target.hasRunningSubprocess);
  if (runningTargets.length === 0) return true;
  if (!(await terminalCloseConfirmationEnabled())) return true;

  return confirmClose(
    runningTargets.length === 1
      ? [
          m(msg('Close terminal "{label}"?', { label: runningTargets[0]!.label })),
          m(msg("This stops the running process and clears its history.")),
        ].join("\n")
      : [
          m(
            msg("Close {count, plural, one {{count} terminal} other {{count} terminals}}?", {
              count: runningTargets.length,
            }),
          ),
          m(
            msg("This stops their running processes and clears their histories: {labels}.", {
              labels: runningTargets.map((target) => `"${target.label}"`).join(", "),
            }),
          ),
        ].join("\n"),
  );
}
