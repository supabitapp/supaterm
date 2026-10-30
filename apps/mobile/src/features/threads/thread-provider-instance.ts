import { useMemo } from "react";

import type { EnvironmentThreadShell } from "@supaterm/client-runtime/state/shell";
import {
  normalizeProviderAccentColor,
  resolveProviderInstanceDisplayName,
  shouldShowInstanceBadge,
} from "@supaterm/client-runtime/state/provider-instance-display";
import type { EnvironmentId, ProviderDriverKind } from "@supaterm/contracts";

import type { ThreadListProvider } from "../../state/thread-list-environments";
export interface ThreadRowProviderInstance {
  readonly driverKind: ProviderDriverKind;
  readonly displayName: string;
  readonly accentColor?: string | undefined;
  readonly showBadge: boolean;
}

/**
 * Resolve the provider instance a thread runs on, scoped to the thread's own
 * environment: default instance ids are the driver slug, so the same id
 * names a different account on every server.
 */
export function resolveThreadProviderInstance(
  providers: ReadonlyArray<ThreadListProvider> | undefined,
  thread: EnvironmentThreadShell,
): ThreadRowProviderInstance | null {
  if (providers === undefined) return null;
  const instanceId = thread.runtime?.providerInstanceId ?? thread.modelSelection.instanceId;
  const snapshot = providers.find((provider) => provider.instanceId === instanceId);
  return snapshot ? describeProviderInstance(snapshot, providers) : null;
}

export function describeProviderInstance(
  snapshot: ThreadListProvider,
  providers: ReadonlyArray<ThreadListProvider>,
): ThreadRowProviderInstance {
  const entry = {
    driverKind: snapshot.driver,
    displayName: resolveProviderInstanceDisplayName(snapshot),
    accentColor: normalizeProviderAccentColor(snapshot.accentColor),
  };
  return {
    ...entry,
    showBadge: shouldShowInstanceBadge(
      { ...entry, enabled: snapshot.enabled },
      providers.map((provider) => ({ driverKind: provider.driver, enabled: provider.enabled })),
    ),
  };
}

/** Cache per provider-list generation to keep memoized row props stable. */
export function createThreadRowProviderInstanceResolver(
  providersByEnvironmentId: ReadonlyMap<EnvironmentId, ReadonlyArray<ThreadListProvider>>,
): (thread: EnvironmentThreadShell) => ThreadRowProviderInstance | null {
  const cache = new Map<string, ThreadRowProviderInstance | null>();
  return (thread) => {
    const instanceId = thread.runtime?.providerInstanceId ?? thread.modelSelection.instanceId;
    const cacheKey = `${thread.environmentId}|${instanceId ?? ""}`;
    const cached = cache.get(cacheKey);
    if (cached !== undefined) return cached;
    const resolved = resolveThreadProviderInstance(
      providersByEnvironmentId.get(thread.environmentId),
      thread,
    );
    cache.set(cacheKey, resolved);
    return resolved;
  };
}

export function useThreadRowProviderInstanceResolver(
  providersByEnvironmentId: ReadonlyMap<EnvironmentId, ReadonlyArray<ThreadListProvider>>,
): (thread: EnvironmentThreadShell) => ThreadRowProviderInstance | null {
  return useMemo(
    () => createThreadRowProviderInstanceResolver(providersByEnvironmentId),
    [providersByEnvironmentId],
  );
}
