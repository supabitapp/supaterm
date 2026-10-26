import type { ScopedThreadRef } from "@supaterm/contracts";

const THREAD_RENAME_START_EVENT = "supaterm:thread-rename-start";

export function requestThreadRename(threadRef: ScopedThreadRef): void {
  window.dispatchEvent(new CustomEvent(THREAD_RENAME_START_EVENT, { detail: threadRef }));
}

export function subscribeThreadRename(listener: (threadRef: ScopedThreadRef) => void): () => void {
  const handler = (event: Event) => listener((event as CustomEvent<ScopedThreadRef>).detail);
  window.addEventListener(THREAD_RENAME_START_EVENT, handler);
  return () => window.removeEventListener(THREAD_RENAME_START_EVENT, handler);
}
