export function isPreviewFocused(): boolean {
  const activeElement = document.activeElement;
  if (!(activeElement instanceof HTMLElement)) return false;
  if (!activeElement.isConnected) return false;
  if (activeElement.tagName.toLowerCase() === "webview") return true;
  return activeElement.closest("[data-preview-panel-mode]") !== null;
}

/** Resolves preview shortcut labels as they apply while the preview owns focus. */
export const PREVIEW_FOCUS_SHORTCUT_OPTIONS = { context: { previewFocus: true } };
