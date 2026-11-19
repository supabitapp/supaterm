import type { ServerSettings } from "@supaterm/contracts";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as Stream from "effect/Stream";

import * as ProviderHost from "./ProviderHost.ts";

export interface ProviderSnapshotSettings<Settings> {
  readonly provider: Settings;
  readonly enableProviderUpdateChecks: boolean;
}

function makeProviderSnapshotSettings<Settings>(
  provider: Settings,
  settings: ServerSettings,
): ProviderSnapshotSettings<Settings>;
function makeProviderSnapshotSettings<Settings>(provider: Settings, settings: ServerSettings) {
  return {
    provider,
    enableProviderUpdateChecks: settings.enableProviderUpdateChecks,
  } satisfies ProviderSnapshotSettings<Settings>;
}

export function haveProviderSnapshotSettingsChanged<Settings>(
  previous: ProviderSnapshotSettings<Settings>,
  next: ProviderSnapshotSettings<Settings>,
): boolean;
export function haveProviderSnapshotSettingsChanged<Settings>(
  previous: ProviderSnapshotSettings<Settings>,
  next: ProviderSnapshotSettings<Settings>,
) {
  return !Equal.equals(previous, next) satisfies boolean;
}

export const makeProviderSnapshotSettingsSource = Effect.fn(
  "snapshotSettings.makeProviderSnapshotSettingsSource",
)(function* <Settings>(provider: Settings) {
  const { settings } = yield* ProviderHost.ProviderHost;
  const mapSettings = (current: ServerSettings) => makeProviderSnapshotSettings(provider, current);
  return {
    getSettings: settings.get.pipe(Effect.map(mapSettings)),
    streamSettings: settings.changes.pipe(Stream.map(mapSettings)),
  };
});
