import { scopedThreadKey, scopeThreadRef } from "@supaterm/client-runtime/environment";
import type { AnyRouter } from "@tanstack/react-router";

import { isAppModalPage } from "../components/sidebar/mainAppLocation";
import { useComposerDraftStore } from "../composerDraftStore";
import { resolveThreadRouteTarget, type ThreadRouteTarget } from "../threadRoutes";
import { useChatPaneStore } from "./store";

function shownThreadKey(target: ThreadRouteTarget | null): string | null {
  if (target?.kind === "server") return scopedThreadKey(target.threadRef);
  if (target?.kind !== "draft") return null;
  const draftSession = useComposerDraftStore.getState().getDraftSession(target.draftId);
  return draftSession
    ? scopedThreadKey(scopeThreadRef(draftSession.environmentId, draftSession.threadId))
    : null;
}

/**
 * The threads on screen: the route's and the pane workspace's. The pane layout
 * outlives pages without panes, so its threads count only on a thread route or
 * under Settings and Usage, which render over the workspace.
 */
export function readShownThreadKeys(router: AnyRouter): ReadonlySet<string> {
  const routeTarget = resolveThreadRouteTarget(router.state.matches.at(-1)?.params ?? {});
  const panesShown = routeTarget !== null || isAppModalPage(router.state.location.pathname);
  const paneCells = panesShown ? (useChatPaneStore.getState().layout?.cells ?? []) : [];
  const shown = new Set<string>();
  for (const target of [routeTarget, ...paneCells.map((cell) => cell.target)]) {
    const threadKey = shownThreadKey(target);
    if (threadKey !== null) shown.add(threadKey);
  }
  return shown;
}
