import {
  resolveEnvironmentMachineKind,
  type EnvironmentId,
  type EnvironmentMachineKind,
  type ServerConfig,
  type ServerProvider,
} from "@supaterm/contracts";
import { Atom } from "effect/reactivity";

export type ThreadListProvider = Pick<
  ServerProvider,
  "instanceId" | "driver" | "enabled" | "displayName" | "accentColor" | "iconUrl"
>;

function selectEnvironment(config: ServerConfig) {
  return {
    providers: config.providers.map(
      ({ instanceId, driver, enabled, displayName, accentColor, iconUrl }) => ({
        instanceId,
        driver,
        enabled,
        displayName,
        accentColor,
        iconUrl,
      }),
    ),
    machineKind: resolveEnvironmentMachineKind(config),
    snoozePresets: config.settings.snoozePresets,
  };
}

type ListEnvironment = ReturnType<typeof selectEnvironment>;

function sameProviders(
  left: ReadonlyArray<ThreadListProvider>,
  right: ReadonlyArray<ThreadListProvider>,
) {
  return (
    left.length === right.length &&
    left.every((provider, index) => {
      const other = right[index]!;
      return (
        provider.instanceId === other.instanceId &&
        provider.driver === other.driver &&
        provider.enabled === other.enabled &&
        provider.displayName === other.displayName &&
        provider.accentColor === other.accentColor &&
        provider.iconUrl === other.iconUrl
      );
    })
  );
}

function collectEnvironments(environments: ReadonlyMap<EnvironmentId, ListEnvironment>) {
  const providersByEnvironmentId = new Map<EnvironmentId, ReadonlyArray<ThreadListProvider>>();
  const snoozePresetsByEnvironmentId = new Map<
    EnvironmentId,
    ServerConfig["settings"]["snoozePresets"]
  >();
  const machineByEnvironmentId = new Map<EnvironmentId, EnvironmentMachineKind>();
  for (const [id, { providers, machineKind, snoozePresets }] of environments) {
    providersByEnvironmentId.set(id, providers);
    snoozePresetsByEnvironmentId.set(id, snoozePresets);
    machineByEnvironmentId.set(id, machineKind);
  }
  return {
    providersByEnvironmentId,
    snoozePresetsByEnvironmentId,
    machineByEnvironmentId,
    loadedEnvironmentIds: new Set(environments.keys()),
  };
}

export function createThreadListEnvironmentsAtom(
  configsAtom: Atom.Atom<ReadonlyMap<EnvironmentId, ServerConfig>>,
) {
  let previous = new Map<EnvironmentId, ListEnvironment>();
  let result = collectEnvironments(previous);
  return Atom.make((get) => {
    const configs = get(configsAtom);
    const next = new Map<EnvironmentId, ListEnvironment>();
    let changed = configs.size !== previous.size;
    for (const [id, config] of configs) {
      const selected = selectEnvironment(config);
      const prior = previous.get(id);
      if (prior && sameProviders(prior.providers, selected.providers)) {
        selected.providers = prior.providers;
      }
      if (prior && JSON.stringify(prior.snoozePresets) === JSON.stringify(selected.snoozePresets)) {
        selected.snoozePresets = prior.snoozePresets;
      }
      const unchanged =
        prior &&
        prior.providers === selected.providers &&
        prior.machineKind === selected.machineKind &&
        prior.snoozePresets === selected.snoozePresets;
      next.set(id, unchanged ? prior : selected);
      if (!unchanged) changed = true;
    }
    if (changed) {
      previous = next;
      result = collectEnvironments(next);
    }
    return result;
  }).pipe(Atom.withLabel("thread-list-environments"));
}
