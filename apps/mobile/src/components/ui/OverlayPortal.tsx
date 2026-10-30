import { type ReactNode, useEffect, useState, useSyncExternalStore } from "react";
import { View } from "react-native";

type Entries = ReadonlyMap<number, ReactNode>;

let nextKey = 0;

function allocateKey() {
  return nextKey++;
}
const entries = new Map<number, ReactNode>();
const listeners = new Set<() => void>();
let snapshot: Entries = new Map();

function emit() {
  snapshot = new Map(entries);
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return snapshot;
}

export function OverlayPortal(props: { readonly children: ReactNode }) {
  const [key] = useState(allocateKey);

  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- projects children into the out-of-tree overlay host store after every commit
  useEffect(() => {
    entries.set(key, props.children);
    emit();
  });

  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- removes this entry from the overlay host store on unmount
  useEffect(
    () => () => {
      entries.delete(key);
      emit();
    },
    [key],
  );

  return null;
}

export function OverlayPortalHost() {
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  if (current.size === 0) {
    return null;
  }
  return (
    <View pointerEvents="box-none" className="absolute inset-0">
      {[...current.entries()].map(([key, node]) => (
        <View key={key} pointerEvents="box-none" className="absolute inset-0">
          {node}
        </View>
      ))}
    </View>
  );
}
