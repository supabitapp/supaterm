import { useRef, useSyncExternalStore, use } from "react";
import { useSyncExternalStoreWithSelector } from "use-sync-external-store/with-selector";
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import {
  DEFAULT_SERVER_SETTINGS,
  AuthSettingsWriteScope,
  requiredScopesForServerSettingsPatch,
  type EnvironmentId,
  type ProviderInstanceMutation,
  type ProviderInstanceId,
  ServerSettings,
  type ServerSettingsPatch,
  sessionGrantsScope,
} from "@supaterm/contracts";
import {
  type ClientSettingsPatch,
  type ClientSettings,
  DEFAULT_CLIENT_SETTINGS,
  type UnifiedSettings,
} from "@supaterm/contracts/settings";
import { safeErrorLogAttributes } from "@supaterm/client-runtime/errors";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@supaterm/client-runtime/state/runtime";
import {
  filterSharedServerPatch,
  splitSharedServerPatch,
  supportsSharedSettingsSync,
} from "@supaterm/client-runtime/state/shared-settings";
import { ensureLocalApi } from "~/localApi";
import * as Equal from "effect/Equal";
import * as Struct from "effect/Struct";
import { AsyncResult, Atom } from "effect/reactivity";
import { toastManager } from "~/components/ui/toast";
import { isHostedStaticApp } from "~/hostedPairing";

import { primaryServerSettingsAtom, serverEnvironment } from "~/state/server";
import { useEnvironments, usePrimaryEnvironment } from "~/state/environments";
import { useAtomCommand } from "~/state/use-atom-command";
import {
  environmentSession,
  environmentSessionStatesAtom,
  readEnvironmentScope,
  useEnvironmentScope,
} from "~/state/session";
import { environmentIdsKey } from "~/state/environmentAtomList";
import { appAtomRegistry } from "~/rpc/atomRegistry";

const CLIENT_SETTINGS_PERSISTENCE_ERROR_SCOPE = "[CLIENT_SETTINGS]";

type UnifiedSettingsPatch = ServerSettingsPatch & ClientSettingsPatch;

const clientSettingsListeners = new Set<() => void>();
const clientSettingsHydrationListeners = new Set<() => void>();
type ClientSettingsHydrationStatus = "pending" | "ready" | "failed" | "retrying";
let clientSettingsSnapshot = DEFAULT_CLIENT_SETTINGS;
let clientSettingsHydrationStatus: ClientSettingsHydrationStatus = "pending";
let clientSettingsHydrationPromise: Promise<void> | null = null;
let clientSettingsHydrationGeneration = 0;
let clientSettingsPersistenceQueue: Promise<void> = Promise.resolve();
let deferredClientSettingsPatchCount = 0;

function emitClientSettingsChange() {
  for (const listener of clientSettingsListeners) {
    listener();
  }
}

function emitClientSettingsHydrationChange() {
  for (const listener of clientSettingsHydrationListeners) {
    listener();
  }
}

function getClientSettingsSnapshot(): ClientSettings {
  return clientSettingsSnapshot;
}

function replaceClientSettingsSnapshot(settings: ClientSettings): void {
  clientSettingsSnapshot = settings;
  emitClientSettingsChange();
}

function setClientSettingsHydrationStatus(nextStatus: ClientSettingsHydrationStatus): void {
  if (clientSettingsHydrationStatus === nextStatus) {
    return;
  }
  clientSettingsHydrationStatus = nextStatus;
  emitClientSettingsHydrationChange();
}

export function subscribeClientSettings(listener: () => void): () => void {
  clientSettingsListeners.add(listener);
  void hydrateClientSettings().catch(() => undefined);
  return () => {
    clientSettingsListeners.delete(listener);
  };
}

export function getClientSettingsHydratedSnapshot(): boolean {
  return clientSettingsHydrationStatus === "ready";
}

function getClientSettingsHydrationStatusSnapshot(): ClientSettingsHydrationStatus {
  return clientSettingsHydrationStatus;
}

export function subscribeClientSettingsHydration(listener: () => void): () => void {
  clientSettingsHydrationListeners.add(listener);
  void hydrateClientSettings().catch(() => undefined);
  return () => {
    clientSettingsHydrationListeners.delete(listener);
  };
}

async function hydrateClientSettings(): Promise<void> {
  if (clientSettingsHydrationStatus === "ready") {
    return;
  }
  if (clientSettingsHydrationPromise) {
    return clientSettingsHydrationPromise;
  }

  const hydrationGeneration = clientSettingsHydrationGeneration;
  setClientSettingsHydrationStatus(
    clientSettingsHydrationStatus === "failed" || clientSettingsHydrationStatus === "retrying"
      ? "retrying"
      : "pending",
  );
  const nextHydration = (async () => {
    try {
      const persistedSettings = await ensureLocalApi().persistence.getClientSettings();
      if (hydrationGeneration !== clientSettingsHydrationGeneration) {
        return;
      }
      if (persistedSettings) {
        replaceClientSettingsSnapshot({ ...DEFAULT_CLIENT_SETTINGS, ...persistedSettings });
      }
      setClientSettingsHydrationStatus("ready");
    } catch (error) {
      if (hydrationGeneration === clientSettingsHydrationGeneration) {
        setClientSettingsHydrationStatus("failed");
      }
      console.error(`${CLIENT_SETTINGS_PERSISTENCE_ERROR_SCOPE} hydrate failed`, {
        operation: "hydrate",
        ...safeErrorLogAttributes(error),
      });
      throw error;
    }
  })();

  const hydrationPromise = nextHydration.finally(() => {
    if (clientSettingsHydrationPromise === hydrationPromise) {
      clientSettingsHydrationPromise = null;
    }
  });
  clientSettingsHydrationPromise = hydrationPromise;

  return clientSettingsHydrationPromise;
}

const defaultClientSettingsPersistence = (settings: ClientSettings): Promise<void> =>
  ensureLocalApi().persistence.setClientSettings(settings);

function enqueueClientSettingsPersistence<A>(work: () => Promise<A>): Promise<A> {
  const result = clientSettingsPersistenceQueue.then(work);
  clientSettingsPersistenceQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/** A function patch is computed from the settings it applies to, so nested objects merge safely. */
export function persistClientSettingsPatch(
  patch: ClientSettingsPatch | ((settings: ClientSettings) => ClientSettingsPatch),
  persist: (settings: ClientSettings) => Promise<void> = defaultClientSettingsPersistence,
): Promise<void> {
  const applyPatch = () => {
    const current = getClientSettingsSnapshot();
    replaceClientSettingsSnapshot({
      ...current,
      ...(typeof patch === "function" ? patch(current) : patch),
    });
  };
  // Patches queued before hydration must publish before newer optimistic patches.
  const deferPatch =
    clientSettingsHydrationStatus !== "ready" || deferredClientSettingsPatchCount > 0;
  if (deferPatch) {
    deferredClientSettingsPatchCount += 1;
  } else {
    applyPatch();
  }
  return enqueueClientSettingsPersistence(async () => {
    if (deferPatch) {
      try {
        if (clientSettingsHydrationStatus !== "ready") {
          await hydrateClientSettings();
        }
        applyPatch();
      } finally {
        deferredClientSettingsPatchCount -= 1;
      }
    }
    await persist(getClientSettingsSnapshot());
  }).catch((error) => {
    console.error(`${CLIENT_SETTINGS_PERSISTENCE_ERROR_SCOPE} persist failed`, {
      operation: "persist",
      ...safeErrorLogAttributes(error),
    });
  });
}

/**
 * If another settings write lands while persistence is pending, the updater is
 * reapplied to that newer snapshot and persisted again so neither change is
 * lost.
 */
export async function persistClientSettingsUpdate(
  update: (current: ClientSettings) => ClientSettings,
  persist: (settings: ClientSettings) => Promise<void> = defaultClientSettingsPersistence,
): Promise<ClientSettings> {
  return enqueueClientSettingsPersistence(async () => {
    if (clientSettingsHydrationStatus !== "ready") {
      await hydrateClientSettings();
    }
    for (;;) {
      const current = getClientSettingsSnapshot();
      const next = update(current);
      await persist(next);
      if (getClientSettingsSnapshot() === current) {
        replaceClientSettingsSnapshot(next);
        return next;
      }
    }
  });
}

const SERVER_SETTINGS_KEYS = new Set<string>(Struct.keys(ServerSettings.fields));

function splitPatch(patch: UnifiedSettingsPatch): {
  serverPatch: ServerSettingsPatch;
  clientPatch: ClientSettingsPatch;
} {
  const serverPatch: Record<string, unknown> = {};
  const clientPatch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (SERVER_SETTINGS_KEYS.has(key)) {
      serverPatch[key] = value;
    } else {
      clientPatch[key] = value;
    }
  }
  return {
    serverPatch: serverPatch as ServerSettingsPatch,
    clientPatch: clientPatch as ClientSettingsPatch,
  };
}

export function getClientSettings(): ClientSettings {
  return getClientSettingsSnapshot();
}

export function isClientSettingsHydrated(): boolean {
  return getClientSettingsHydratedSnapshot();
}

/**
 * Failed reads reject and remain retryable. They must not allow defaults to overwrite saved
 * preferences.
 */
export function ensureClientSettingsHydrated(): Promise<void> {
  return hydrateClientSettings();
}

export function useClientSettingsHydrated(): boolean {
  return useSyncExternalStore(
    subscribeClientSettingsHydration,
    getClientSettingsHydratedSnapshot,
    () => false,
  );
}

export function useClientSettingsHydrationStatus(): ClientSettingsHydrationStatus {
  return useSyncExternalStore(
    subscribeClientSettingsHydration,
    getClientSettingsHydrationStatusSnapshot,
    () => "pending",
  );
}

const getDefaultClientSettings = () => DEFAULT_CLIENT_SETTINGS;
const selectWholeClientSettings = (settings: ClientSettings) => settings;

/**
 * The selection, not the whole snapshot, is what the store compares, so a write re-renders only
 * readers whose selected value changed. Selectors may build objects or arrays: a structurally
 * equal result keeps the previous reference.
 */
export function useClientSettings<T = ClientSettings>(
  selector?: (settings: ClientSettings) => T,
): T {
  return useSyncExternalStoreWithSelector(
    subscribeClientSettings,
    getClientSettingsSnapshot,
    getDefaultClientSettings,
    selector ?? (selectWholeClientSettings as (settings: ClientSettings) => T),
    Equal.equals,
  );
}

export function mergeEnvironmentSettings(
  serverSettings: ServerSettings,
  clientSettings: ClientSettings,
): UnifiedSettings {
  // Decode drops retired client keys, but older untyped persistence adapters
  // can still return them. Server-owned values must always win.
  return {
    ...clientSettings,
    ...serverSettings,
  };
}

/** Selecting inside the client store keeps a client write from re-rendering unaffected readers. */
export function useMergedSettings<T = UnifiedSettings>(
  serverSettings: ServerSettings,
  selector?: (settings: UnifiedSettings) => T,
): T {
  return useClientSettings((clientSettings) => {
    const merged = mergeEnvironmentSettings(serverSettings, clientSettings);
    return selector ? selector(merged) : (merged as T);
  });
}

export function useUpdateEnvironmentModelPreferences(environmentId: EnvironmentId | null) {
  const settings = useAtomValue(
    environmentId ? serverEnvironment.settingsValueAtom(environmentId) : noEnvironmentSettingsAtom,
  );
  const save = useAtomCommand(serverEnvironment.updateSettings, "model preferences update");
  return async (patch: ServerSettingsPatch) => {
    if (!environmentId || !settings) return;
    return save({ environmentId, input: { patch } });
  };
}

/** Send the desired state so two clients adding a favorite do not cancel each other. */
export function useToggleEnvironmentModelFavorite(environmentId: EnvironmentId | null) {
  const registry = use(RegistryContext);
  const pendingFavorites = useRef(
    new Map<string, { favorite: boolean; settings: ServerSettings; pending: boolean }>(),
  );
  const save = useUpdateEnvironmentModelPreferences(environmentId);
  return async (provider: ProviderInstanceId, model: string) => {
    if (!environmentId) return;
    const settingsAtom = serverEnvironment.settingsValueAtom(environmentId);
    const currentSettings = registry.get(settingsAtom);
    if (!currentSettings) return;
    const favorites = currentSettings.favorites;
    const key = JSON.stringify([environmentId, provider, model]);
    const previous = pendingFavorites.current.get(key);
    // Keep the acknowledged choice until the config stream catches up with the RPC reply.
    const previousFavorite =
      previous && (previous.pending || previous.settings.favorites === currentSettings.favorites)
        ? previous.favorite
        : favorites.some((favorite) => favorite.provider === provider && favorite.model === model);
    const pending = {
      favorite: !previousFavorite,
      settings: currentSettings,
      pending: true,
    };
    pendingFavorites.current.set(key, pending);
    // save settles into a result and never rejects, so the rollback below always runs.
    const result = await save({
      setModelFavorites: [{ provider, model, favorite: pending.favorite }],
    });
    if (
      result &&
      AsyncResult.isSuccess(result) &&
      registry.get(settingsAtom)?.favorites === currentSettings.favorites
    ) {
      pending.pending = false;
    }
    if (pending.pending && pendingFavorites.current.get(key) === pending) {
      if (
        previous &&
        !previous.pending &&
        registry.get(settingsAtom)?.favorites === previous.settings.favorites
      ) {
        pendingFavorites.current.set(key, previous);
      } else {
        pendingFavorites.current.delete(key);
      }
    }
  };
}

const noEnvironmentSettingsAtom = Atom.make<ServerSettings | null>(null);

export function useEnvironmentModelPreferences(environmentId: EnvironmentId | null) {
  const settings = useAtomValue(
    environmentId ? serverEnvironment.settingsValueAtom(environmentId) : noEnvironmentSettingsAtom,
  );
  const { favorites, providerModelPreferences } = settings ?? DEFAULT_SERVER_SETTINGS;
  return { favorites, providerModelPreferences };
}

export function useEnvironmentSettings<T = UnifiedSettings>(
  environmentId: EnvironmentId,
  selector?: (settings: UnifiedSettings) => T,
): T {
  const serverSettings = useAtomValue(serverEnvironment.settingsValueAtom(environmentId));
  return useMergedSettings(serverSettings ?? DEFAULT_SERVER_SETTINGS, selector);
}

export function usePersistEnvironmentProviderInstanceMutation(environmentId: EnvironmentId) {
  const mutateProviderInstance = useAtomCommand(serverEnvironment.mutateProviderInstance, {
    reportFailure: false,
  });
  return (providerInstanceMutation: ProviderInstanceMutation, patch: ServerSettingsPatch = {}) =>
    mutateProviderInstance({
      environmentId,
      input: { patch, providerInstanceMutation },
    });
}

export function usePrimarySettings<T = UnifiedSettings>(
  selector?: (settings: UnifiedSettings) => T,
): T {
  const settings = useAtomValue(primaryServerSettingsAtom);
  return useMergedSettings(settings, selector);
}

export const PRIMARY_SETTINGS_UNAVAILABLE_MESSAGE =
  "This setting is saved on a server, and the hosted app is not anchored to one. Change it from the desktop app or from the server's own address.";

/**
 * The hosted app connects to every environment as a remote, so it has no
 * primary: `usePrimarySettings` reads schema defaults there and writes have
 * nowhere to go.
 */
export function usePrimarySettingsAvailable(): boolean {
  const primaryEnvironment = usePrimaryEnvironment();
  return primaryEnvironment !== null || !isHostedStaticApp();
}

function useSharedSettingsSyncTargetIds(includePending = false): ReadonlyArray<EnvironmentId> {
  const { environments } = useEnvironments();
  const targetIds = environments
    .filter(supportsSharedSettingsSync)
    .map(({ environmentId }) => environmentId);
  const results = useAtomValue(environmentSessionStatesAtom(environmentIdsKey(targetIds)));
  return targetIds.flatMap((environmentId, index) => {
    const result = results[index]!;
    // A cold grant must not drop a shared edit. The server authorizes the
    // write; mismatch suggestions still wait for a confirmed grant.
    if (includePending && result._tag === "Initial") {
      return [environmentId];
    }
    const session = result._tag === "Failure" ? null : AsyncResult.getOrElse(result, () => null);
    return session !== null && sessionGrantsScope(session, AuthSettingsWriteScope)
      ? [environmentId]
      : [];
  });
}

function useUpdateSettingsTarget(environmentId: EnvironmentId | null) {
  useEnvironmentScope(environmentId, AuthSettingsWriteScope);
  const persist = useAtomCommand(serverEnvironment.updateSettings, {
    label: "server settings update",
    reportFailure: false,
  });
  const { environments } = useEnvironments();
  const persistServerSettings = async (request: Parameters<typeof persist>[0]) => {
    const result = await persist(request);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const label =
        environments.find((environment) => environment.environmentId === request.environmentId)
          ?.label ?? request.environmentId;
      const error = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: "Setting not saved",
        description: `Could not save on ${label}: ${error instanceof Error ? error.message : "The save failed. Try reconnecting and saving again."}`,
      });
    }
    return result;
  };
  const sharedSettingsSyncTargetIds = useSharedSettingsSyncTargetIds(true);
  const updateSettings = (patch: UnifiedSettingsPatch) => {
    const { serverPatch, clientPatch } = splitPatch(patch);

    const canWriteServerPatch =
      environmentId === null ||
      requiredScopesForServerSettingsPatch(serverPatch).every((scope) =>
        readEnvironmentScope(environmentId, scope),
      );
    if (Object.keys(serverPatch).length > 0 && !canWriteServerPatch) {
      toastManager.add({
        type: "warning",
        title: "Setting not saved",
        description: `This connection lacks permission to change settings on ${environments.find((target) => target.environmentId === environmentId)?.label ?? "the selected environment"}.`,
      });
    }
    if (Object.keys(serverPatch).length > 0 && canWriteServerPatch) {
      const { sharedPatch, localPatch } = splitSharedServerPatch(serverPatch);
      // Dropping the write silently leaves the control looking saved.
      const warnUnsaved = (description = PRIMARY_SETTINGS_UNAVAILABLE_MESSAGE) =>
        toastManager.add({
          type: "warning",
          title: "Setting not saved",
          description,
        });
      if (Object.keys(localPatch).length > 0) {
        if (environmentId) {
          void persistServerSettings({
            environmentId,
            input: { patch: localPatch },
          });
        } else {
          warnUnsaved();
        }
      }
      if (Object.keys(sharedPatch).length > 0) {
        const sourceSettings = environments.find((target) => target.environmentId === environmentId)
          ?.serverConfig?.settings;
        const targets = new Set(sharedSettingsSyncTargetIds);
        if (environmentId) {
          targets.add(environmentId);
        }
        const writes: Array<Parameters<typeof persist>[0]> = [];
        const deniedLabels: string[] = [];
        for (const targetId of targets) {
          const target = environments.find((candidate) => candidate.environmentId === targetId);
          const targetPatch = filterSharedServerPatch(
            sharedPatch,
            target?.serverConfig?.settings,
            sourceSettings,
            targetId === environmentId,
          );
          if (Object.keys(targetPatch).length === 0) continue;
          const session = appAtomRegistry.get(environmentSession.sessionStateAtom(targetId));
          if (
            session._tag !== "Initial" &&
            !requiredScopesForServerSettingsPatch(sharedPatch).every((scope) =>
              readEnvironmentScope(targetId, scope),
            )
          ) {
            deniedLabels.push(target?.label ?? targetId);
            continue;
          }
          writes.push({
            environmentId: targetId,
            input: { patch: targetPatch },
          });
        }
        if (writes.length === 0) {
          warnUnsaved(
            deniedLabels.length > 0
              ? `This connection lacks permission to change settings on ${deniedLabels.join(", ")}.`
              : targets.size > 0
                ? "Update older servers to save this setting."
                : undefined,
          );
        } else {
          void Promise.all(
            writes.map(async (request) => ({
              label:
                environments.find((target) => target.environmentId === request.environmentId)
                  ?.label ?? request.environmentId,
              result: await persist(request),
            })),
          ).then((outcomes) => {
            const failures = outcomes.flatMap(({ label, result }) => {
              if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return [];
              const error = squashAtomCommandFailure(result);
              return [
                `Could not save on ${label}: ${error instanceof Error ? error.message : "The save failed. Try reconnecting and saving again."}`,
              ];
            });
            if (failures.length === 0) return;
            const saved = outcomes
              .filter(({ result }) => result._tag === "Success")
              .map(({ label }) => label);
            toastManager.add({
              type: "error",
              title: saved.length > 0 ? "Setting saved on some environments" : "Setting not saved",
              description: [
                ...failures,
                ...(saved.length > 0 ? [`Saved on ${saved.join(", ")}.`] : []),
              ].join("\n"),
            });
          });
        }
      }
    }
    if (Object.keys(clientPatch).length > 0) {
      void persistClientSettingsPatch(clientPatch);
    }
  };

  return updateSettings;
}

export function useUpdateEnvironmentSettings(environmentId: EnvironmentId | null) {
  return useUpdateSettingsTarget(environmentId);
}

export function useUpdatePrimarySettings() {
  return useUpdateSettingsTarget(usePrimaryEnvironment()?.environmentId ?? null);
}

export function updateClientSettings(
  patch: Parameters<typeof persistClientSettingsPatch>[0],
): Promise<void> {
  return persistClientSettingsPatch(patch);
}

export function __resetClientSettingsPersistenceForTests(): void {
  clientSettingsHydrationGeneration += 1;
  clientSettingsSnapshot = DEFAULT_CLIENT_SETTINGS;
  clientSettingsHydrationStatus = "pending";
  clientSettingsHydrationPromise = null;
  clientSettingsPersistenceQueue = Promise.resolve();
  deferredClientSettingsPatchCount = 0;
  clientSettingsListeners.clear();
  clientSettingsHydrationListeners.clear();
}

export function __setClientSettingsForTests(settings: ClientSettings): void {
  clientSettingsHydrationGeneration += 1;
  clientSettingsSnapshot = settings;
  clientSettingsHydrationStatus = "ready";
  clientSettingsHydrationPromise = null;
}
