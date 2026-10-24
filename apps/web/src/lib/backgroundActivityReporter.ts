import { EnvironmentRegistry } from "@supaterm/client-runtime/connection";
import {
  EnvironmentRpcSubscriptionObserver,
  request,
  type EnvironmentRpcSubscriptionObservation,
} from "@supaterm/client-runtime/rpc";
import {
  type BackgroundScope,
  type ClientActivityReportInput,
  type EnvironmentId,
  type ThreadId,
  WS_METHODS,
} from "@supaterm/contracts";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import { randomUUID } from "./utils";

const CLIENT_ID_STORAGE_KEY = "supaterm.backgroundActivity.clientId";
const REPORT_INTERVAL_MS = 25_000;
const LEASE_TTL_MS = 45_000;
const RECENT_INTERACTION_WINDOW_MS = LEASE_TTL_MS;
const BASELINE_SCOPES: ReadonlyArray<BackgroundScope> = [{ type: "provider-status" }];

interface RetainedScope {
  readonly environmentId: EnvironmentId;
  readonly scope: BackgroundScope;
  refCount: number;
  /** For a shown thread, the attention last observed; undefined until the first observation. */
  attentionKey?: string | null;
}

const retainedScopes = new Map<string, RetainedScope>();
const retainedScopeListeners = new Set<() => void>();
const shownAttentionListeners = new Set<(environmentId: EnvironmentId) => void>();

function notifyRetainedScopesChanged(): void {
  for (const listener of retainedScopeListeners) {
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

function getClientId(): string {
  try {
    const existing = window.localStorage.getItem(CLIENT_ID_STORAGE_KEY);
    if (existing) return existing;
    const next = randomUUID();
    window.localStorage.setItem(CLIENT_ID_STORAGE_KEY, next);
    return next;
  } catch {
    return "ephemeral-browser-client";
  }
}

function resolveClientKind(): ClientActivityReportInput["clientKind"] {
  return window.desktopBridge ? "desktop-renderer" : "web";
}

export function wasRecentlyInteracted(lastInteractionAtMs: number, observedAtMs: number): boolean {
  return (
    lastInteractionAtMs <= observedAtMs &&
    observedAtMs - lastInteractionAtMs <= RECENT_INTERACTION_WINDOW_MS
  );
}

export function createActivityReport(
  environmentId: EnvironmentId,
  lastInteractionAtMs: number,
  lastInputAtMs: number | null,
  observedAtMs: number,
): ClientActivityReportInput {
  const scopes = [...BASELINE_SCOPES];
  for (const entry of retainedScopes.values()) {
    if (entry.environmentId === environmentId) {
      scopes.push(entry.scope);
    }
  }
  return {
    environmentId,
    clientId: getClientId(),
    clientKind: resolveClientKind(),
    visible: document.visibilityState === "visible",
    focused: document.hasFocus(),
    recentlyInteracted: wasRecentlyInteracted(lastInteractionAtMs, observedAtMs),
    appState: document.visibilityState === "visible" ? "active" : "background",
    scopes,
    ttlMs: LEASE_TTL_MS,
    observedAt: DateTime.makeUnsafe(observedAtMs),
    ...(lastInputAtMs === null ? {} : { lastInteractionAt: DateTime.makeUnsafe(lastInputAtMs) }),
  };
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

export function retainBackgroundScope(
  environmentId: EnvironmentId,
  scope: BackgroundScope,
): () => void {
  const key = stableScopeKey(environmentId, scope);
  const existing = retainedScopes.get(key);
  if (existing) {
    existing.refCount += 1;
  } else {
    retainedScopes.set(key, { environmentId, scope, refCount: 1 });
    notifyRetainedScopesChanged();
  }

  return () => {
    const current = retainedScopes.get(key);
    if (!current) return;
    current.refCount -= 1;
    if (current.refCount <= 0) {
      retainedScopes.delete(key);
      notifyRetainedScopesChanged();
    }
  };
}

export function observeBackgroundActivitySubscription(
  observation: EnvironmentRpcSubscriptionObservation,
): Effect.Effect<Effect.Effect<void>> {
  const scope = scopeForSubscription(observation);
  if (scope === null) {
    return Effect.succeed(Effect.void);
  }
  return Effect.sync(() => {
    const release = retainBackgroundScope(observation.environmentId as EnvironmentId, scope);
    return Effect.sync(release);
  });
}

export function retainedBackgroundScopes(
  environmentId: EnvironmentId,
): ReadonlyArray<BackgroundScope> {
  return Array.from(retainedScopes.values(), (entry) =>
    entry.environmentId === environmentId ? entry.scope : null,
  ).filter((scope): scope is BackgroundScope => scope !== null);
}

/**
 * The host briefly holds a completion push and drops it when a client reports, after the
 * event, that it shows the thread and had input just before. A shown thread whose attention
 * changes reports at once instead of on the next interval. The first observation only records
 * the key, since retaining the scope already reported.
 */
export function observeShownThreadAttention(
  environmentId: EnvironmentId,
  threadId: ThreadId,
  attentionKey: string | null,
): void {
  const entry = retainedScopes.get(stableScopeKey(environmentId, { type: "thread", threadId }));
  if (entry === undefined) return;
  const prior = entry.attentionKey;
  entry.attentionKey = attentionKey;
  if (prior === undefined || attentionKey === null || attentionKey === prior) return;
  for (const listener of shownAttentionListeners) listener(environmentId);
}

export const layerObserver = Layer.succeed(
  EnvironmentRpcSubscriptionObserver,
  EnvironmentRpcSubscriptionObserver.of({
    observe: observeBackgroundActivitySubscription,
  }),
);

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
    const clock = yield* Clock.Clock;
    const reportRequests = yield* Queue.sliding<void>(1);
    let reportAll = true;
    const pendingEnvironments = new Set<EnvironmentId>();
    const requestReport = () => {
      reportAll = true;
      Queue.offerUnsafe(reportRequests, undefined);
    };
    const requestEnvironmentReport = (environmentId: EnvironmentId) => {
      pendingEnvironments.add(environmentId);
      Queue.offerUnsafe(reportRequests, undefined);
    };
    let lastInteractionAtMs = clock.currentTimeMillisUnsafe();
    // Real input only; the value above starts at load so a fresh window counts as recent.
    let lastInputAtMs: number | null = null;
    const recordInteraction = () => {
      const observedAtMs = clock.currentTimeMillisUnsafe();
      const wasRecent = wasRecentlyInteracted(lastInteractionAtMs, observedAtMs);
      lastInteractionAtMs = observedAtMs;
      lastInputAtMs = observedAtMs;
      if (!wasRecent) {
        requestReport();
      }
    };
    const passiveListenerOptions = { passive: true } as const;

    const report = Effect.gen(function* () {
      const observedAtMs = yield* Clock.currentTimeMillis;
      const entries = yield* SubscriptionRef.get(registry.entries);
      const all = reportAll;
      const pending = new Set(pendingEnvironments);
      reportAll = false;
      pendingEnvironments.clear();
      yield* Effect.forEach(
        Array.from(entries.keys()).filter((environmentId) => all || pending.has(environmentId)),
        (environmentId) =>
          registry
            .run(
              environmentId,
              request(
                WS_METHODS.serverReportClientActivity,
                createActivityReport(
                  environmentId,
                  lastInteractionAtMs,
                  lastInputAtMs,
                  observedAtMs,
                ),
              ),
            )

            .pipe(Effect.ignoreCause),
        { concurrency: "unbounded", discard: true },
      );
    }).pipe(Effect.withSpan("web.backgroundActivity.report"));

    yield* Effect.acquireRelease(
      Effect.sync(() => {
        retainedScopeListeners.add(requestReport);
        shownAttentionListeners.add(requestEnvironmentReport);
        document.addEventListener("visibilitychange", requestReport);
        window.addEventListener("focus", requestReport);
        window.addEventListener("blur", requestReport);
        window.addEventListener("online", requestReport);
        window.addEventListener("pointermove", recordInteraction);
        window.addEventListener("keydown", recordInteraction);
        window.addEventListener("wheel", recordInteraction, passiveListenerOptions);
        window.addEventListener("touchstart", recordInteraction, passiveListenerOptions);
      }),
      () =>
        Effect.sync(() => {
          retainedScopeListeners.delete(requestReport);
          shownAttentionListeners.delete(requestEnvironmentReport);
          document.removeEventListener("visibilitychange", requestReport);
          window.removeEventListener("focus", requestReport);
          window.removeEventListener("blur", requestReport);
          window.removeEventListener("online", requestReport);
          window.removeEventListener("pointermove", recordInteraction);
          window.removeEventListener("keydown", recordInteraction);
          window.removeEventListener("wheel", recordInteraction);
          window.removeEventListener("touchstart", recordInteraction);
        }),
    );

    yield* SubscriptionRef.changes(registry.entries).pipe(
      Stream.runForEach(() => Effect.sync(requestReport)),
      Effect.forkScoped,
    );
    yield* Stream.fromQueue(reportRequests).pipe(
      Stream.debounce("250 millis"),
      Stream.runForEach(() => report),
      Effect.forkScoped,
    );
    yield* Effect.sync(requestReport).pipe(
      Effect.repeat(Schedule.spaced(`${REPORT_INTERVAL_MS} millis`)),
      Effect.forkScoped,
    );
  }),
);
