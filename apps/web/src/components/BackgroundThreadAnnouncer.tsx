import { scopeThreadRef, scopedThreadKey } from "@supaterm/client-runtime/environment";
import { effectiveSnoozed } from "@supaterm/client-runtime/state/thread-snooze";
import type { AnyRouter } from "@tanstack/react-router";
import type { AtomRegistry } from "effect/reactivity";

import { useChatPaneStore } from "../chatPanes/store";
import { useComposerDraftStore } from "../composerDraftStore";
import { createLiveRegion } from "../hooks/useLiveRegion";
import { liveShellEnvironmentIdsAtom } from "../state/shell";
import { environmentThreadShells } from "../state/threads";
import { resolveActiveThreadRouteRef, resolveThreadRouteTarget } from "../threadRoutes";
import {
  type BackgroundThreadMemory,
  type BackgroundThreadSnapshot,
  nextBackgroundThreadAnnouncement,
  resolveBackgroundThreadRequest,
} from "./backgroundThreadAnnouncement";

const backgroundThreadLiveRegion = createLiveRegion();
const attachBackgroundThreadRegion = backgroundThreadLiveRegion.attach;

/** The route's thread and every split-pane thread, in a stable order for comparison. */
function readOpenThreadKeys(router: AnyRouter): ReadonlyArray<string> {
  const target = resolveThreadRouteTarget(router.state.matches.at(-1)?.params ?? {});
  const draft =
    target?.kind === "draft"
      ? useComposerDraftStore.getState().getDraftSession(target.draftId)
      : null;
  const ref = resolveActiveThreadRouteRef(target, draft);
  const keys = new Set(
    (useChatPaneStore.getState().layout?.cells ?? []).flatMap((cell) =>
      cell.target.kind === "server" ? [scopedThreadKey(cell.target.threadRef)] : [],
    ),
  );
  if (ref !== null) keys.add(scopedThreadKey(ref));
  return [...keys].toSorted();
}

/** Speaks status changes for threads no open pane shows, for the life of the app. */
export function startBackgroundThreadAnnouncements(
  registry: AtomRegistry.AtomRegistry,
  router: AnyRouter,
): () => void {
  let memory: BackgroundThreadMemory = new Map();
  let openThreadKeys = readOpenThreadKeys(router);

  const update = () => {
    const threads = registry.get(environmentThreadShells.quietThreadShellsAtom);
    const liveEnvironmentIds = registry.get(liveShellEnvironmentIdsAtom);
    const now = new Date().toISOString();
    const snapshots: BackgroundThreadSnapshot[] = [];
    for (const thread of threads) {
      // Subagents have no row of their own; their requests surface on the parent.
      if (thread.archivedAt !== null || thread.lineage.relationshipToParent === "subagent")
        continue;
      if (!liveEnvironmentIds.has(thread.environmentId)) continue;
      snapshots.push({
        key: scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
        title: thread.title,
        ...resolveBackgroundThreadRequest(thread),
        runId: thread.latestRun?.runId ?? null,
        runStatus: thread.latestRun?.status ?? null,
        activeRunId: thread.runtime?.activeRunId ?? null,
        snoozed: effectiveSnoozed(thread, { now }),
      });
    }
    const next = nextBackgroundThreadAnnouncement(memory, snapshots, new Set(openThreadKeys));
    memory = next.memory;
    if (next.announcement !== null) backgroundThreadLiveRegion.announce(next.announcement);
  };

  // The draft and pane stores change often; only a new set of open threads matters here.
  const updateOpenThreads = () => {
    const next = readOpenThreadKeys(router);
    if (next.join("\n") === openThreadKeys.join("\n")) return;
    openThreadKeys = next;
    update();
  };

  const unsubscribes = [
    registry.subscribe(environmentThreadShells.quietThreadShellsAtom, update),
    registry.subscribe(liveShellEnvironmentIdsAtom, update),
    router.subscribe("onResolved", updateOpenThreads),
    useComposerDraftStore.subscribe(updateOpenThreads),
    useChatPaneStore.subscribe(updateOpenThreads),
  ];
  update();
  return () => {
    for (const unsubscribe of unsubscribes) unsubscribe();
  };
}

/**
 * The region the background announcements are spoken through. It lives outside
 * the sidebar because a collapsed sidebar is inert, which silences its rows.
 */
export function BackgroundThreadAnnouncer() {
  // No role="status": Orca 50 maps it to a status bar in Chromium and drops its updates.
  return <div ref={attachBackgroundThreadRegion} aria-live="polite" className="sr-only" />;
}
