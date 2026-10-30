import type { ScopedThreadRef } from "@supaterm/contracts";
import type { GhosttyTerminalSurface } from "./ghostty/surface";

export const SCRIPT_PASTE_READY_TIMEOUT_MS = 5_000;
export const SCRIPT_PASTE_UNSUPPORTED_MESSAGE =
  "This terminal can't run multi-line scripts. Copy the script instead.";
export const SCRIPT_PASTE_CLOSED_MESSAGE = "The terminal closed before the script ran.";

type ScriptPasteTarget = ScopedThreadRef & { terminalId: string };
type ScriptPasteSurface = Pick<GhosttyTerminalSurface, "encodeScriptPaste" | "subscribeOutput">;
interface PendingScriptPaste {
  readonly tryEncode: () => void;
  readonly reject: (message: string) => void;
}

const surfaces = new Map<string, ScriptPasteSurface>();
const pendingByKey = new Map<string, Set<PendingScriptPaste>>();

function targetKey(target: ScriptPasteTarget): string {
  return JSON.stringify([target.environmentId, target.threadId, target.terminalId]);
}

export function registerTerminalScriptPasteSurface(
  target: ScriptPasteTarget,
  surface: ScriptPasteSurface,
): () => void {
  const key = targetKey(target);
  const notify = () => {
    for (const pending of pendingByKey.get(key) ?? []) pending.tryEncode();
  };
  surfaces.set(key, surface);
  const unsubscribe = surface.subscribeOutput(notify);
  notify();
  return () => {
    unsubscribe();
    if (surfaces.get(key) !== surface) return;
    surfaces.delete(key);
    // A session reopened under the same id is not the one the user confirmed the script for.
    for (const pending of pendingByKey.get(key) ?? []) pending.reject(SCRIPT_PASTE_CLOSED_MESSAGE);
  };
}

/**
 * Typed lines would let a command that reads stdin (an installer prompt, `sudo`) swallow the
 * lines after it, so scripts only go in as one bracketed paste. A fresh shell enables bracketed
 * paste after its first prompt, so wait for it instead of falling back to typing.
 */
export function encodeTerminalScriptPaste(
  target: ScriptPasteTarget,
  script: string,
): Promise<string> {
  const key = targetKey(target);
  return new Promise((resolve, reject) => {
    const pendingForKey = pendingByKey.get(key) ?? new Set<PendingScriptPaste>();
    pendingByKey.set(key, pendingForKey);
    const settle = () => {
      clearTimeout(timeout);
      pendingForKey.delete(pending);
      if (pendingForKey.size === 0) pendingByKey.delete(key);
    };
    const pending: PendingScriptPaste = {
      tryEncode: () => {
        const data = surfaces.get(key)?.encodeScriptPaste(script);
        if (data == null) return;
        settle();
        resolve(data);
      },
      reject: (message) => {
        settle();
        reject(new Error(message));
      },
    };
    const timeout = setTimeout(
      () => pending.reject(SCRIPT_PASTE_UNSUPPORTED_MESSAGE),
      SCRIPT_PASTE_READY_TIMEOUT_MS,
    );
    pendingForKey.add(pending);
    pending.tryEncode();
  });
}
