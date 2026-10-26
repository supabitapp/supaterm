const THREAD_RENAME_START_EVENT = "supaterm:thread-rename-start";

export function requestThreadRename(): void {
  window.dispatchEvent(new Event(THREAD_RENAME_START_EVENT));
}

export function subscribeThreadRename(listener: () => void): () => void {
  window.addEventListener(THREAD_RENAME_START_EVENT, listener);
  return () => window.removeEventListener(THREAD_RENAME_START_EVENT, listener);
}
