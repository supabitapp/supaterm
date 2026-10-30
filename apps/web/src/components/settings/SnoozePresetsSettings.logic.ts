import type { SnoozePresetSetting } from "@supaterm/contracts/settings";
import { resolveSnoozePreset } from "@supaterm/client-runtime/state/thread-snooze";
import * as Equal from "effect/Equal";

export function reconcileSnoozeDraft<T>(
  pending: ReadonlyArray<T>,
  saved: T,
): { readonly adopt: true } | { readonly adopt: false; readonly pending: ReadonlyArray<T> } {
  const acknowledged = pending.findIndex((snapshot) => Equal.equals(snapshot, saved));
  return acknowledged === -1
    ? { adopt: true }
    : { adopt: false, pending: pending.slice(acknowledged + 1) };
}

export function sortSnoozeRows<K>(
  presets: ReadonlyArray<SnoozePresetSetting>,
  keys: ReadonlyArray<K>,
  now: Date,
): { readonly presets: ReadonlyArray<SnoozePresetSetting>; readonly keys: ReadonlyArray<K> } {
  const order = presets
    .map((preset, index) => ({
      index,
      wake: resolveSnoozePreset(preset, now)?.snoozedUntil ?? null,
    }))
    .toSorted((a, b) =>
      a.wake === b.wake ? 0 : a.wake === null ? 1 : b.wake === null ? -1 : a.wake < b.wake ? -1 : 1,
    );
  return {
    presets: order.map(({ index }) => presets[index]!),
    keys: order.map(({ index }) => keys[index]!),
  };
}
