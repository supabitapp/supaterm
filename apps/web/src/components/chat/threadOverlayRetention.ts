import type { AnyRouter } from "@tanstack/react-router";

import { readShownThreadKeys } from "../../chatPanes/shownThreads";
import { useChatPaneStore } from "../../chatPanes/store";

const retainers: Array<(shownThreadKeys: ReadonlySet<string>) => void> = [];

export function registerThreadOverlay(retain: (shownThreadKeys: ReadonlySet<string>) => void) {
  retainers.push(retain);
}

/** Chat overlays and find belong to the thread they were opened in, so a thread off screen drops them. */
export function startThreadOverlayRetention(router: AnyRouter) {
  const retain = () => {
    const shown = readShownThreadKeys(router);
    for (const retainOverlays of retainers) retainOverlays(shown);
  };
  const unsubscribes = [router.subscribe("onResolved", retain), useChatPaneStore.subscribe(retain)];
  return () => {
    for (const unsubscribe of unsubscribes) unsubscribe();
  };
}
