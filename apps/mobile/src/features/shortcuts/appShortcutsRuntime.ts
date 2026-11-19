import * as QuickActions from "expo-quick-actions";
import { Platform } from "react-native";
import type { NavigationState } from "@react-navigation/native";
import type { ScopedThreadRef } from "@supaterm/contracts";
import { Atom } from "effect/reactivity";

import { environmentCatalog } from "../../connection/catalog";
import {
  loadRecentThreadShortcuts,
  saveRecentThreadShortcuts,
  type RecentThreadShortcut,
} from "../../persistence/imperative";
import { rootNavigationRef, whenRootNavigationReady } from "../../lib/rootNavigation";
import { uuidv4 } from "../../lib/uuid";
import { appAtomRegistry } from "../../state/atom-registry";
import { environmentThreadShells } from "../../state/threads";
import { readStartNewTaskDestination } from "../threads/use-start-new-task";
import { selectWorkspaceDetail } from "../layout/workspace/workspace-detail-selection";
import {
  activeThreadRef,
  buildShortcutActions,
  NEW_TASK_SHORTCUT_ID,
  shortcutHref,
  withRecentThreadShortcut,
} from "./appShortcuts";

export interface RecentThreadShortcutsDependencies {
  readonly load: () => Promise<ReadonlyArray<RecentThreadShortcut>>;
  readonly save: (recents: ReadonlyArray<RecentThreadShortcut>) => Promise<void>;
  readonly publish: (recents: ReadonlyArray<RecentThreadShortcut>) => Promise<void>;
}

/**
 * Keeps the launcher's recent-thread list. Recording waits for the persisted
 * list so the first thread opened after a cold start cannot clobber older
 * entries, and a failed load never persists its empty fallback over valid
 * history until a real thread open makes the in-memory list the new truth.
 */
export function createRecentThreadShortcuts(dependencies: RecentThreadShortcutsDependencies) {
  let recents: ReadonlyArray<RecentThreadShortcut> | null = null;
  let persistable = false;
  let active: RecentThreadShortcut | null = null;
  let savedEnvironmentIds: ReadonlySet<string> | null = null;
  let saveQueue: Promise<unknown> = Promise.resolve();

  const commit = (next: ReadonlyArray<RecentThreadShortcut>) => {
    recents = next;
    if (persistable) {
      saveQueue = saveQueue.then(
        () =>
          dependencies.save(next).catch((error: unknown) => {
            console.warn("[app-shortcuts] failed to persist recent threads", error);
          }),
        () => undefined,
      );
    }
    void dependencies.publish(next).catch((error: unknown) => {
      console.warn("[app-shortcuts] failed to update launcher shortcuts", error);
    });
  };

  const isSaved = (thread: RecentThreadShortcut) =>
    savedEnvironmentIds?.has(thread.environmentId) ?? true;

  const withActive = (list: ReadonlyArray<RecentThreadShortcut>) => {
    if (active === null || !isSaved(active)) return list;
    const next = withRecentThreadShortcut(list, active);
    if (next !== list) persistable = true;
    return next;
  };

  const loaded = dependencies.load().then(
    (threads) => {
      persistable = true;
      commit(withActive(threads.filter(isSaved)));
    },
    (error: unknown) => {
      console.warn("[app-shortcuts] failed to load recent threads", error);
      commit(withActive([]));
    },
  );

  return {
    loaded,
    saved: () => saveQueue,
    recordActiveThread(next: RecentThreadShortcut | null) {
      active = next;
      if (recents === null || next === null) return;
      const updated = withActive(recents);
      if (updated !== recents) commit(updated);
    },
    retainEnvironments(next: ReadonlySet<string>) {
      savedEnvironmentIds = next;
      if (recents === null) return;
      const kept = recents.filter(isSaved);
      if (kept.length !== recents.length) commit(kept);
    },
  };
}

const activeThreadRefAtom = Atom.make<ScopedThreadRef | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("mobile:app-shortcuts-active-thread-ref"),
);

const activeThreadShortcutAtom = Atom.make((get) => {
  const ref = get(activeThreadRefAtom);
  if (ref === null) return null;
  const title = get(environmentThreadShells.threadShellAtom(ref))?.title ?? "";
  return { environmentId: ref.environmentId, threadId: ref.threadId, title };
}).pipe(
  Atom.withEquality(
    (left: RecentThreadShortcut | null, right: RecentThreadShortcut | null) =>
      left === right ||
      (left !== null &&
        right !== null &&
        left.environmentId === right.environmentId &&
        left.threadId === right.threadId &&
        left.title === right.title),
  ),
);

/** Wired to the root navigation container's state changes. */
export function recordAppShortcutNavigationState(state: NavigationState) {
  if (Platform.OS !== "android") return;
  const next = activeThreadRef(state);
  const current = appAtomRegistry.get(activeThreadRefAtom);
  if (next?.environmentId === current?.environmentId && next?.threadId === current?.threadId) {
    return;
  }
  appAtomRegistry.set(activeThreadRefAtom, next);
}

/**
 * App-lifetime quick actions. `navigate` must queue until navigation is ready:
 * a cold-start shortcut arrives as the launch action, and pushing it over the
 * initial Home route makes back return home instead of exiting the app.
 */
export function installAppShortcuts(navigate: (href: string) => void) {
  const open = (action: QuickActions.Action) => {
    if (action.id === NEW_TASK_SHORTCUT_ID) {
      void readStartNewTaskDestination(uuidv4()).then((params) =>
        whenRootNavigationReady(() =>
          rootNavigationRef.dispatch(selectWorkspaceDetail({ name: "Thread", params })),
        ),
      );
      return;
    }
    const href = shortcutHref(action);
    if (href !== null) navigate(href);
  };
  if (QuickActions.initial) open(QuickActions.initial);
  const subscription = QuickActions.addListener(open);
  if (Platform.OS !== "android") return () => subscription.remove();

  const recents = createRecentThreadShortcuts({
    load: loadRecentThreadShortcuts,
    save: saveRecentThreadShortcuts,
    publish: (list) => QuickActions.setItems(buildShortcutActions(list)),
  });
  const unsubscribe = appAtomRegistry.subscribe(
    activeThreadShortcutAtom,
    (active) => recents.recordActiveThread(active),
    { immediate: true },
  );
  const unsubscribeCatalog = appAtomRegistry.subscribe(
    environmentCatalog.catalogValueAtom,
    (catalog) => {
      if (catalog.isReady) recents.retainEnvironments(new Set(catalog.entries.keys()));
    },
    { immediate: true },
  );
  return () => {
    subscription.remove();
    unsubscribe();
    unsubscribeCatalog();
  };
}
