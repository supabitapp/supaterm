import type { EnvironmentRpcSubscriptionObservation } from "@supaterm/client-runtime/rpc";
import {
  type BackgroundScope,
  type EnvironmentId,
  type ThreadId,
  WS_METHODS,
} from "@supaterm/contracts";
import * as Effect from "effect/Effect";

interface RetainedScope {
  readonly environmentId: EnvironmentId;
  readonly scope: BackgroundScope;
  refCount: number;
}

const retainedScopes = new Map<string, RetainedScope>();
const listeners = new Set<() => void>();

function notify(targets: ReadonlySet<() => void>): void {
  for (const listener of targets) {
    try {
      listener();
    } catch {}
  }
}

function stableScopeKey(environmentId: EnvironmentId, scope: BackgroundScope): string {
  switch (scope.type) {
    case "server-config":
    case "diagnostics":
      return JSON.stringify([environmentId, scope.type]);
    case "provider-status":
      return JSON.stringify([environmentId, scope.type, scope.instanceId ?? null]);
    case "vcs-status":
    case "git-refs":
      return JSON.stringify([environmentId, scope.type, scope.cwd]);
    case "thread":
      return JSON.stringify([environmentId, scope.type, scope.threadId]);
  }
}

function scopeForSubscription(
  observation: EnvironmentRpcSubscriptionObservation,
): BackgroundScope | null {
  if (observation.method === WS_METHODS.subscribeResourceTelemetry) {
    return { type: "diagnostics" };
  }
  if (observation.method !== WS_METHODS.subscribeVcsStatus) {
    return null;
  }
  const input = observation.input as { readonly cwd?: unknown; readonly includeRemote?: unknown };
  if (input.includeRemote === false) return null;
  return typeof input.cwd === "string" ? { type: "vcs-status", cwd: input.cwd } : null;
}

function retainScope(environmentId: EnvironmentId, scope: BackgroundScope): () => void {
  const key = stableScopeKey(environmentId, scope);
  const current = retainedScopes.get(key);
  if (current) {
    current.refCount += 1;
  } else {
    retainedScopes.set(key, { environmentId, scope, refCount: 1 });
    notify(listeners);
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const retained = retainedScopes.get(key);
    if (!retained) return;
    retained.refCount -= 1;
    if (retained.refCount <= 0) {
      retainedScopes.delete(key);
      notify(listeners);
    }
  };
}

/** Tells the host which thread is on screen, so it can hold back alerts the user is already seeing. */
export function retainMobileThreadScope(
  environmentId: EnvironmentId,
  threadId: ThreadId,
): () => void {
  return retainScope(environmentId, { type: "thread", threadId });
}

export function retainedMobileBackgroundScopes(
  environmentId: EnvironmentId,
): ReadonlyArray<BackgroundScope> {
  return Array.from(retainedScopes.values(), (entry) =>
    entry.environmentId === environmentId ? entry.scope : null,
  ).filter((scope): scope is BackgroundScope => scope !== null);
}

export function observeMobileBackgroundActivitySubscription(
  observation: EnvironmentRpcSubscriptionObservation,
): Effect.Effect<Effect.Effect<void>> {
  const scope = scopeForSubscription(observation);
  if (scope === null) return Effect.succeed(Effect.void);
  return Effect.sync(() => {
    const release = retainScope(observation.environmentId as EnvironmentId, scope);
    return Effect.sync(release);
  });
}

export function onRetainedMobileBackgroundScopesChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const INTERACTION_REPORT_INTERVAL_MS = 5_000;
let lastInteractionAtMs: number | null = null;
let lastReportedInteractionAtMs = 0;
const interactionListeners = new Set<() => void>();

export function latestMobileInteractionAt(): number | null {
  return lastInteractionAtMs;
}

/**
 * Records a real touch. The host only trusts touches, not `AppState`, to decide the user is
 * watching a thread, so reports follow touches but at most every few seconds.
 */
export function recordMobileInteraction(now = Date.now()): void {
  lastInteractionAtMs = now;
  if (now - lastReportedInteractionAtMs < INTERACTION_REPORT_INTERVAL_MS) return;
  lastReportedInteractionAtMs = now;
  notify(interactionListeners);
}

export function onMobileInteraction(listener: () => void): () => void {
  interactionListeners.add(listener);
  return () => {
    interactionListeners.delete(listener);
  };
}
