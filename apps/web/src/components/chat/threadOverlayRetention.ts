import { scopedThreadKey, scopeThreadRef } from "@supaterm/client-runtime/environment";
import type { AnyRouter } from "@tanstack/react-router";

import { useChatPaneStore } from "../../chatPanes/store";
import { useComposerDraftStore } from "../../composerDraftStore";
import { isAppModalPage } from "../sidebar/mainAppLocation";
import { resolveThreadRouteTarget, type ThreadRouteTarget } from "../../threadRoutes";

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

/** The thread a route or pane shows, as the key its chat overlays were opened under. */
function shownThreadKey(target: ThreadRouteTarget | null): string | null {
  if (target?.kind === "server") return scopedThreadKey(target.threadRef);
  const draftSession =
    target?.kind === "draft"
      ? useComposerDraftStore.getState().getDraftSession(target.draftId)
      : null;
  return draftSession
    ? scopedThreadKey(scopeThreadRef(draftSession.environmentId, draftSession.threadId))
    : null;
}

/**
 * Chat overlays and find belong to the thread they were opened in, so a thread no
 * route or pane shows drops them. The pane layout outlives pages without panes,
 * so its threads count only on a thread route or under Settings and Usage.
 */
export function startThreadOverlayRetention(router: AnyRouter): () => void {
  const retain = () => {
    const shown = new Set<string>();
    const routeTarget = resolveThreadRouteTarget(router.state.matches.at(-1)?.params ?? {});
    const routeKey = shownThreadKey(routeTarget);
    if (routeKey !== null) shown.add(routeKey);
    const panesShown = routeTarget !== null || isAppModalPage(router.state.location.pathname);
    for (const cell of panesShown ? (useChatPaneStore.getState().layout?.cells ?? []) : []) {
      const paneKey = shownThreadKey(cell.target);
      if (paneKey !== null) shown.add(paneKey);
    }
    for (const retainOverlays of retainers) retainOverlays(shown);
  };
  const unsubscribes = [router.subscribe("onResolved", retain), useChatPaneStore.subscribe(retain)];
  return () => {
    for (const unsubscribe of unsubscribes) unsubscribe();
  };
}
