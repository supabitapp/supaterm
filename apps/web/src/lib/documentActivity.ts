export interface DocumentActivity {
  readonly visible: boolean;
  readonly focused: boolean;
}

const ALWAYS_ACTIVE: DocumentActivity = { visible: true, focused: true };

const listeners = new Set<() => void>();
let snapshot: DocumentActivity = ALWAYS_ACTIVE;

function readActivity(): DocumentActivity {
  if (typeof document === "undefined") return ALWAYS_ACTIVE;
  const visible = document.visibilityState === "visible";
  const focused = document.hasFocus();
  return snapshot.visible === visible && snapshot.focused === focused
    ? snapshot
    : { visible, focused };
}

function handleActivityEvent() {
  const next = readActivity();
  if (next === snapshot) return;
  snapshot = next;
  for (const listener of listeners) listener();
}

export function getDocumentActivity(): DocumentActivity {
  if (listeners.size === 0) snapshot = readActivity();
  return snapshot;
}

export function subscribeDocumentActivity(listener: () => void): () => void {
  if (typeof document === "undefined") return () => {};
  if (listeners.size === 0) {
    snapshot = readActivity();
    document.addEventListener("visibilitychange", handleActivityEvent);
    window.addEventListener("focus", handleActivityEvent);
    window.addEventListener("blur", handleActivityEvent);
  }
  listeners.add(listener);
  return () => {
    if (!listeners.delete(listener) || listeners.size > 0) return;
    document.removeEventListener("visibilitychange", handleActivityEvent);
    window.removeEventListener("focus", handleActivityEvent);
    window.removeEventListener("blur", handleActivityEvent);
  };
}
