import type { ScopedThreadRef } from "@supaterm/contracts";

import { whenPreviewTabKnown } from "~/previewStateStore";
import { useRightPanelStore } from "~/rightPanelStore";

export function showPreviewPopup(threadRef: ScopedThreadRef, popupTabId: string): void {
  whenPreviewTabKnown(threadRef, popupTabId, () => {
    useRightPanelStore.getState().openBrowser(threadRef, popupTabId);
  });
}
