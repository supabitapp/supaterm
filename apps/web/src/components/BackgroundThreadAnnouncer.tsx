import { scopeThreadRef, scopedThreadKey } from "@supaterm/client-runtime/environment";
import { effectiveSnoozed } from "@supaterm/client-runtime/state/thread-snooze";
import { isListedThreadLineage } from "@supaterm/contracts";
import type { AnyRouter } from "@tanstack/react-router";
import type { AtomRegistry } from "effect/reactivity";

import { readShownThreadKeys } from "../chatPanes/shownThreads";
import { useChatPaneStore } from "../chatPanes/store";
import { useComposerDraftStore } from "../composerDraftStore";
import { createLiveRegion } from "../hooks/useLiveRegion";
import { liveShellEnvironmentIdsAtom } from "../state/shell";
import { environmentThreadShells } from "../state/threads";
import {
  type BackgroundThreadMemory,
  type BackgroundThreadSnapshot,
  nextBackgroundThreadAnnouncement,
  resolveBackgroundThreadRequest,
} from "./backgroundThreadAnnouncement";

const backgroundThreadLiveRegion = createLiveRegion();
const attachBackgroundThreadRegion = backgroundThreadLiveRegion.attach;

/** Speaks status changes for threads no open pane shows, for the life of the app. */
export function startBackgroundThreadAnnouncements(
  registry: AtomRegistry.AtomRegistry,
  router: AnyRouter,
): () => void {
  let memory: BackgroundThreadMemory = new Map();
  let openThreadKeys = readShownThreadKeys(router);

  const update = () => {
    const threads = registry.get(environmentThreadShells.quietThreadShellsAtom);
    const liveEnvironmentIds = registry.get(liveShellEnvironmentIdsAtom);
    const now = new Date().toISOString();
    const snapshots: BackgroundThreadSnapshot[] = [];
    for (const thread of threads) {
      // Subagents and side chats have no row of their own; their requests surface on the parent.
      if (thread.archivedAt !== null || !isListedThreadLineage(thread.lineage)) continue;
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
    const next = nextBackgroundThreadAnnouncement(memory, snapshots, openThreadKeys);
    memory = next.memory;
    if (next.announcement !== null) backgroundThreadLiveRegion.announce(next.announcement);
  };

  // The draft and pane stores change often; only a new set of open threads matters here.
  const updateOpenThreads = () => {
    const next = readShownThreadKeys(router);
    if (next.size === openThreadKeys.size && [...next].every((key) => openThreadKeys.has(key)))
      return;
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
