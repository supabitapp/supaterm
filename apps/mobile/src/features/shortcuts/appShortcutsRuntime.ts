import * as QuickActions from "expo-quick-actions";
import { Platform } from "react-native";
import type { NavigationState } from "@react-navigation/native";
import type { ScopedThreadRef } from "@supaterm/contracts";
import { Atom } from "effect/reactivity";

import {
  loadRecentThreadShortcuts,
  saveRecentThreadShortcuts,
  type RecentThreadShortcut,
} from "../../persistence/imperative";
import { appAtomRegistry } from "../../state/atom-registry";
import { environmentThreadShells } from "../../state/threads";
import {
  activeThreadRef,
  buildShortcutActions,
  shortcutHref,
  withRecentThreadShortcut,
} from "./appShortcuts";

export interface RecentThreadShortcutsDependencies {
  readonly load: () => Promise<ReadonlyArray<RecentThreadShortcut>>;
  readonly save: (recents: ReadonlyArray<RecentThreadShortcut>) => Promise<void>;
  readonly publish: (recents: ReadonlyArray<RecentThreadShortcut>) => Promise<void>;
}

export function createRecentThreadShortcuts(dependencies: RecentThreadShortcutsDependencies) {
  let recents: ReadonlyArray<RecentThreadShortcut> | null = null;
  let persistable = false;
  let active: RecentThreadShortcut | null = null;

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

  const withActive = (list: ReadonlyArray<RecentThreadShortcut>) => {
    if (active === null) return list;
    const next = withRecentThreadShortcut(list, active);
    if (next !== list) persistable = true;
    return next;
  };

  const loaded = dependencies.load().then(
    (threads) => {
      persistable = true;
      commit(withActive(threads));
    },
    (error: unknown) => {
      console.warn("[app-shortcuts] failed to load recent threads", error);
      commit(withActive([]));
    },
  );

  return {
    loaded,

    saved: () => saveQueue,
    recordActiveThread(next: RecentThreadShortcut | null): void {
      active = next;
      if (recents === null || next === null) return;
      const updated = withActive(recents);
      if (updated !== recents) commit(updated);
    },
  };
}

const activeThreadRefAtom = Atom.make<ScopedThreadRef | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("mobile:app-shortcuts-active-thread-ref"),
);

const activeThreadShortcutAtom = Atom.make((get): RecentThreadShortcut | null => {
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

export function recordAppShortcutNavigationState(state: NavigationState): void {
  if (Platform.OS !== "android") return;
  const next = activeThreadRef(state);
  const current = appAtomRegistry.get(activeThreadRefAtom);
  if (next?.environmentId === current?.environmentId && next?.threadId === current?.threadId) {
    return;
  }
  appAtomRegistry.set(activeThreadRefAtom, next);
}

export function installAppShortcuts(navigate: (href: string) => void): () => void {
  const initialHref = QuickActions.initial ? shortcutHref(QuickActions.initial) : null;
  if (initialHref !== null) navigate(initialHref);
  const subscription = QuickActions.addListener((action) => {
    const href = shortcutHref(action);
    if (href !== null) navigate(href);
  });
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
  return () => {
    subscription.remove();
    unsubscribe();
  };
}
