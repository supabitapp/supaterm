import { RegistryContext } from "@effect/atom-react";
import { useNavigation } from "@react-navigation/native";
import { useContext, useRef, useSyncExternalStore } from "react";
import type { Atom } from "effect/reactivity";
import { NativeWorkspaceTabActivityContext } from "../../native/v5-workspace-context";

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

export function recordHomeTransitionStart(closing: boolean): void {
  if (!closing) setHomeVisible(true);
}

export function recordHomeTransitionEnd(closing: boolean): void {
  if (closing) setHomeVisible(false);
}

export function recordHomeFocus(): void {
  setHomeVisible(true);
}

export function useHomeRouteVisible(): boolean {
  const tabActivity = useContext(NativeWorkspaceTabActivityContext);
  const navigation = useNavigation();
  const visible = useSyncExternalStore(subscribeHomeVisibility, () => homeVisible);

  return (visible ?? navigation.isFocused()) && (tabActivity?.active ?? true);
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
