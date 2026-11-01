import type { AnyRouter } from "@tanstack/react-router";

import { readShownThreadKeys } from "../../chatPanes/shownThreads";
import { useChatPaneStore } from "../../chatPanes/store";

/**
 * Chat overlays (dialogs, media previews) are opened for one thread and must not
 * outlive every route and pane that shows it. Overlay modules register here when
 * they load, so the route listener can drop them without importing the overlays.
 */
const retainers: Array<(shownThreadKeys: ReadonlySet<string>) => void> = [];

export function registerThreadOverlay(
  retain: (shownThreadKeys: ReadonlySet<string>) => void,
): void {
  retainers.push(retain);
}

/** Chat overlays and find belong to the thread they were opened in, so a thread off screen drops them. */
export function startThreadOverlayRetention(router: AnyRouter): () => void {
  const retain = () => {
    const shown = readShownThreadKeys(router);
    for (const retainOverlays of retainers) retainOverlays(shown);
  };
  const unsubscribes = [router.subscribe("onResolved", retain), useChatPaneStore.subscribe(retain)];
  return () => {
    for (const unsubscribe of unsubscribes) unsubscribe();
  };
}
