import type { DesktopBridge } from "@supaterm/contracts";

import { registerMenuAction } from "../shortcuts/dispatcher";

export const DESKTOP_PASTE_AS_TEXT_EVENT = "supaterm:paste-as-text";

/** Arm composer paste handling before Electron delivers the native clipboard event. */
export function installDesktopPasteAsText(
  bridge: Pick<DesktopBridge, "pasteAsText"> | undefined,
  target: EventTarget,
): () => void {
  return registerMenuAction("paste-as-text", () => {
    target.dispatchEvent(new Event(DESKTOP_PASTE_AS_TEXT_EVENT));
    void bridge?.pasteAsText();
  });
}
