import { RegistryContext } from "@effect/atom-react";
import { useNavigation } from "@react-navigation/native";
import { useContext, useRef, useSyncExternalStore } from "react";
import type { Atom } from "effect/reactivity";

import {
  NativePrimaryColumnContext,
  NativeWorkspaceTabActivityContext,
} from "../../native/v5-workspace-context";

let homeVisible: boolean | null = null;
const visibilityListeners = new Set<() => void>();

function setHomeVisible(next: boolean) {
  if (next === homeVisible) return;
  homeVisible = next;
  for (const listener of visibilityListeners) listener();
}

function subscribeHomeVisibility(onChange: () => void) {
  visibilityListeners.add(onChange);
  return () => {
    visibilityListeners.delete(onChange);
    if (visibilityListeners.size === 0) homeVisible = null;
  };
}

let onHomeCovered: (() => void) | null = null;

/** Runs `action` once the page opening over Home covers it; Home starting to reappear first drops it. */
export function runWhenHomeCovered(action: () => void): void {
  onHomeCovered = action;
}

export function recordHomeTransitionStart(closing: boolean): void {
  if (closing) return;
  onHomeCovered = null;
  setHomeVisible(true);
}

/**
 * Each iOS tab slot shows its own copy of the Home route, and the slot a tab switch leaves
 * disappears last. So a disappear hides Home only when another route has the focus.
 */
export function recordHomeTransitionEnd(closing: boolean, homeFocused: boolean): void {
  if (!closing || homeFocused) return;
  setHomeVisible(false);
  const action = onHomeCovered;
  onHomeCovered = null;
  action?.();
}

/** Popping a sheet or a deep-linked route above Home has no appear event. */
export function recordHomeFocus(): void {
  setHomeVisible(true);
}

export function useHomeRouteVisible(): boolean {
  const navigation = useNavigation();
  const primaryColumn = useContext(NativePrimaryColumnContext);
  const tabActive = useContext(NativeWorkspaceTabActivityContext)?.active ?? true;
  const visible = useSyncExternalStore(subscribeHomeVisibility, () => homeVisible);
  if (primaryColumn) return primaryColumn.presented;
  if (!tabActive) return false;
  return visible ?? navigation.isFocused();
}

export function useAtomValueWhileVisible<A>(atom: Atom.Atom<A>, visible: boolean): A {
  const registry = useContext(RegistryContext);
  const held = useRef<{ readonly value: A } | null>(null);
  const subscribe = (onChange: () => void) =>
    visible ? registry.subscribe(atom, onChange) : () => undefined;
  return useSyncExternalStore(subscribe, () => {
    if (visible || held.current === null) held.current = { value: registry.get(atom) };
    return held.current.value;
  });
}
