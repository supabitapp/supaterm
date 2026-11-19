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

/** Whether the user is looking at this window: the tab is visible and the window has focus. */
export function getDocumentActivity(): DocumentActivity {
  if (listeners.size === 0) snapshot = readActivity();
  return snapshot;
}

/** One visibilitychange/focus/blur listener set shared by every subscriber. */
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

/**
 * Fires on every window focus and every switch to a visible tab. Unlike
 * `subscribeDocumentActivity` it does not wait for the cached activity to flip:
 * focus coming back from an iframe, or an alt-tab whose blur was missed, still
 * counts as a return.
 */
export function subscribeDocumentReturn(
  listener: () => void,
  source?: {
    readonly window: EventTarget;
    readonly document: EventTarget & Pick<Document, "visibilityState">;
  },
) {
  if (source === undefined && typeof document === "undefined") return () => {};
  const { window: view, document: page } = source ?? { window, document };
  const handleVisibilityChange = () => {
    if (page.visibilityState === "visible") listener();
  };
  view.addEventListener("focus", listener);
  page.addEventListener("visibilitychange", handleVisibilityChange);
  return () => {
    view.removeEventListener("focus", listener);
    page.removeEventListener("visibilitychange", handleVisibilityChange);
  };
}
