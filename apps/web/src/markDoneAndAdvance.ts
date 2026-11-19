import type { ScopedThreadRef } from "@supaterm/contracts";

type MarkDoneAndAdvance = (threadRef: ScopedThreadRef) => void;

let registeredMarkDoneAndAdvance: MarkDoneAndAdvance | null = null;

export function registerMarkDoneAndAdvance(handler: MarkDoneAndAdvance): () => void {
  registeredMarkDoneAndAdvance = handler;
  return () => {
    if (registeredMarkDoneAndAdvance === handler) registeredMarkDoneAndAdvance = null;
  };
}

/**
 * Returns false when no sidebar is mounted, so the caller marks done in place.
 */
export function markDoneAndAdvance(threadRef: ScopedThreadRef): boolean {
  if (!registeredMarkDoneAndAdvance) return false;
  registeredMarkDoneAndAdvance(threadRef);
  return true;
}
