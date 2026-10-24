import type { AtomRegistry } from "effect/reactivity";
import * as Schema from "effect/Schema";
import type { EnvironmentId, ThreadId } from "@supaterm/contracts";
import { MessageId } from "@supaterm/contracts";

import {
  createThreadOutboxManager,
  ThreadOutboxManagerError,
  shouldRetryThreadOutboxDelivery,
  threadOutboxRetryDelayMs,
} from "@supaterm/client-runtime/thread-outbox";

const isManagerError = Schema.is(ThreadOutboxManagerError);

export interface ThreadOutboxEntry<Payload> {
  readonly id: string;
  readonly scope: string;
  readonly createdAt: string;
  readonly position: number;
  readonly payload: Payload;
  readonly status: "pending" | "failed" | "delivered";
  /** An unacknowledged attempt must keep its original payload and identifiers. */
  readonly attempted: boolean;
  readonly attempts: number;
  readonly retryAt: number;
  readonly error: string | null;
  readonly paused: boolean;
  readonly pauseUntil: number;
}

export interface BrowserThreadOutboxStorage<Payload> {
  readonly load: () => Promise<ReadonlyArray<ThreadOutboxEntry<Payload>>>;
  /** Updates an existing entry; false when another client has removed it. */
  readonly write: (entry: ThreadOutboxEntry<Payload>) => Promise<boolean>;
  readonly writeMany: (entries: ReadonlyArray<ThreadOutboxEntry<Payload>>) => Promise<void>;
  readonly remove: (id: string) => Promise<void>;
  /** Serializes delivery and edits across clients sharing the same local storage. */
  readonly withLock: <A>(scope: string, action: () => Promise<A>) => Promise<A | null>;
}

/** Browser delivery leases and acknowledgements around the shared mobile queue manager. */
export function createBrowserThreadOutbox<Payload>(options: {
  readonly storage: BrowserThreadOutboxStorage<Payload>;
  readonly registry: AtomRegistry.AtomRegistry;
  readonly identify: (payload: Payload) => {
    readonly environmentId: EnvironmentId;
    readonly threadId: ThreadId;
  };
  readonly now: () => number;
  readonly canDeliver: (entry: ThreadOutboxEntry<Payload>) => boolean;
  /** Keep an acknowledged creation visible until its server shell reaches the client. */
  readonly canRemoveDelivered?: (entry: ThreadOutboxEntry<Payload>) => boolean;
  readonly deliver: (
    entry: ThreadOutboxEntry<Payload>,
    savePayload: (payload: Payload) => Promise<void>,
  ) => Promise<void>;
  readonly shouldRetry?: (error: unknown) => boolean;
}) {
  const queueOrder = (a: ThreadOutboxEntry<Payload>, b: ThreadOutboxEntry<Payload>) =>
    a.createdAt.localeCompare(b.createdAt) || a.position - b.position;
  const manager = createThreadOutboxManager<ThreadOutboxEntry<Payload>>({
    registry: options.registry,
    identify: (entry) => ({
      ...options.identify(entry.payload),
      messageId: MessageId.make(entry.id),
    }),
    compare: queueOrder,
    // Raw bytes are immutable for each attachment ID; edits replace the command ID.
    equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    storage: {
      load: async () => ({ messages: await options.storage.load(), errors: [] }),
      write: options.storage.write,
      writeMany: options.storage.writeMany,
      remove: (entry) => options.storage.remove(entry.id),
    },
  });
  const getEntries = manager.getSnapshot;
  let queueSnapshot = getEntries();
  let renderSnapshot = queueSnapshot;
  const listeners = new Set<() => void>();
  const sending = new Set<string>();
  let loadPromise: Promise<void> | null = null;
  let loaded = false;
  let drainPromise: Promise<number | null> | null = null;
  let position = 0;

  function notify() {
    queueSnapshot = getEntries();
    renderSnapshot = [...queueSnapshot];
    for (const listener of listeners) listener();
  }

  function getSnapshot() {
    const current = getEntries();
    if (current !== queueSnapshot) {
      queueSnapshot = current;
      renderSnapshot = current;
    }
    return renderSnapshot;
  }

  // Preserve the browser's storage error messages at the UI boundary.
  async function mutation<A>(result: Promise<A>): Promise<A> {
    try {
      return await result;
    } catch (error) {
      throw isManagerError(error) ? error.cause : error;
    }
  }

  function refreshPosition() {
    for (const entry of getEntries()) position = Math.max(position, entry.position);
  }

  async function reload() {
    await manager.reload();
    refreshPosition();
  }

  function load() {
    loadPromise ??= manager.load().then((didLoad) => {
      if (!didLoad) {
        loadPromise = null;
        throw new Error("Pending messages could not be loaded.");
      }
      refreshPosition();
      loaded = true;
      for (const listener of listeners) listener();
    });
    return loadPromise;
  }

  function save(entry: ThreadOutboxEntry<Payload>) {
    return mutation(manager.update(entry));
  }

  async function remove(id: string) {
    const entry = getEntries().find((candidate) => candidate.id === id);
    if (entry) await mutation(manager.remove(entry));
  }

  async function enqueueMany(
    inputs: ReadonlyArray<
      Pick<ThreadOutboxEntry<Payload>, "id" | "scope" | "createdAt" | "payload">
    >,
  ) {
    await load();
    // Publish only after the storage transaction commits. Callers may now clear their draft.
    const added = inputs.map((input) => ({
      ...input,
      position: ++position,
      status: "pending" as const,
      attempted: false,
      attempts: 0,
      retryAt: 0,
      error: null,
      paused: false,
      pauseUntil: 0,
    }));
    await mutation(manager.enqueueMany(added));
  }

  function enqueue(
    input: Pick<ThreadOutboxEntry<Payload>, "id" | "scope" | "createdAt" | "payload">,
  ) {
    return enqueueMany([input]);
  }

  function queuedBehind(head: ThreadOutboxEntry<Payload>) {
    return getEntries().filter(
      (entry) => entry.scope === head.scope && queueOrder(entry, head) > 0,
    );
  }

  /** Runs `action` under the entry's delivery lease while the entry may still change. */
  async function withChangeableEntry(
    id: string,
    action: (entry: ThreadOutboxEntry<Payload>) => Promise<boolean>,
  ) {
    await load();
    const candidate = getEntries().find((entry) => entry.id === id);
    if (!candidate) return false;
    return (
      (await options.storage.withLock(`message:${id}`, async () => {
        await reload();
        const live = getEntries().find((entry) => entry.id === id);
        if (!live || live.status === "delivered" || (live.attempted && live.status !== "failed"))
          return false;
        return action(live);
      })) ?? false
    );
  }

  function mutate(
    id: string,
    change: (entry: ThreadOutboxEntry<Payload>) => ThreadOutboxEntry<Payload> | null,
  ) {
    return withChangeableEntry(id, async (live) => {
      const next = change(live);
      if (next === null) await remove(id);
      else if (!(await save(next))) return false;
      return true;
    });
  }

  function edit(id: string, payload: Payload, scope?: string) {
    return mutate(id, (entry) => ({
      ...entry,
      ...(scope === undefined ? {} : { scope }),
      payload,
      status: "pending",
      attempted: false,
      attempts: 0,
      retryAt: 0,
      error: null,
      paused: false,
      pauseUntil: 0,
    }));
  }

  /**
   * Edits an entry into another scope and carries the entries queued behind it
   * along. Holding the source scope keeps the drain from sending any of them to
   * the old thread between the writes.
   */
  async function editWithFollowing(
    id: string,
    payload: Payload,
    scope: string,
    retarget: (payload: Payload) => Payload,
  ): Promise<boolean> {
    await load();
    const head = getEntries().find((entry) => entry.id === id);
    if (!head) return false;
    const moved = await options.storage.withLock(head.scope, async () => {
      await reload();
      // Another tab moved the task since the snapshot: follow it to its scope.
      if (getEntries().find((entry) => entry.id === id)?.scope !== head.scope) return "moved";
      if (!(await edit(id, payload, scope))) return false;
      // The edit reloaded the queue: whatever is still queued for the old
      // thread follows the task, including a follow-up sent while it moved.
      for (const entry of getEntries().filter((candidate) => candidate.scope === head.scope))
        await mutate(entry.id, (live) => ({ ...live, scope, payload: retarget(live.payload) }));
      return true;
    });
    return moved === "moved" ? editWithFollowing(id, payload, scope, retarget) : (moved ?? false);
  }

  /** Cancels an entry and the entries queued behind it, those first so none is left at the head. */
  function cancelWithFollowing(id: string) {
    return withChangeableEntry(id, async (live) => {
      for (const entry of queuedBehind(live)) await remove(entry.id);
      await remove(id);
      return true;
    });
  }

  function pause(id: string, paused: boolean) {
    return mutate(id, (entry) => ({
      ...entry,
      paused,
      pauseUntil: paused ? options.now() + 60_000 : 0,
    }));
  }

  function cancel(id: string) {
    return mutate(id, () => null);
  }

  async function deliverScope(scope: string): Promise<number | null> {
    const locked = await options.storage.withLock(scope, async () => {
      // Another tab may have cancelled, edited or delivered this row since our snapshot.
      await reload();
      const candidate = getEntries()
        .filter((entry) => entry.scope === scope)
        .sort(queueOrder)[0];
      if (!candidate) {
        return { next: null };
      }
      const messageLock = await options.storage.withLock(`message:${candidate.id}`, async () => {
        await reload();
        const head = getEntries().find(
          (entry) => entry.id === candidate.id && entry.scope === scope,
        );
        if (!head) return { next: options.now() };
        if (head.status === "delivered") {
          if (options.canRemoveDelivered?.(head) === false) return { next: null };
          await remove(head.id);
          return { next: options.now() };
        }
        if (head.status === "failed" || !options.canDeliver(head)) return { next: null };
        // Editors renew this lease. A crash must not leave a message paused forever.
        if (head.paused && head.pauseUntil > options.now()) return { next: head.pauseUntil };
        if (head.retryAt > options.now()) return { next: head.retryAt };
        let current = {
          ...head,
          paused: false,
          pauseUntil: 0,
          attempted: true,
          attempts: head.attempts + 1,
        };
        if (!(await save(current))) return { next: null };
        sending.add(current.id);
        notify();
        try {
          try {
            await options.deliver(current, async (payload) => {
              current = { ...current, payload };
              if (!(await save(current))) throw new Error("The pending message was removed.");
            });
          } catch (error) {
            const retry = (options.shouldRetry ?? shouldRetryThreadOutboxDelivery)(error);
            current = {
              ...current,
              status: retry ? "pending" : "failed",
              retryAt: retry ? options.now() + threadOutboxRetryDelayMs(current.attempts) : 0,
              error: error instanceof Error ? error.message : String(error),
            };
            await save(current);
            return { next: retry ? current.retryAt : null };
          }
          // Record acknowledgement before cleanup, so failed deletion can never resend the turn.
          await save({ ...current, status: "delivered", error: null });
        } finally {
          sending.delete(current.id);
          notify();
        }
        if (options.canRemoveDelivered?.(current) === false) return { next: null };
        await remove(current.id);
        return { next: options.now() };
      });
      return messageLock ?? { next: options.now() + 1_000 };
    });
    return locked === null &&
      getEntries().some(
        (entry) =>
          entry.scope === scope &&
          entry.status === "pending" &&
          !entry.paused &&
          options.canDeliver(entry),
      )
      ? options.now() + 1_000
      : (locked?.next ?? null);
  }

  function drain(): Promise<number | null> {
    if (drainPromise) return drainPromise;
    drainPromise = (async () => {
      await load();
      const scopes = [...new Set(getEntries().map((entry) => entry.scope))];
      const remaining = scopes.values();
      const next: Array<number | null> = [];
      // Bound uploads and RPC work when many threads reconnect together.
      await Promise.all(
        Array.from({ length: Math.min(3, scopes.length) }, async () => {
          for (let scope = remaining.next(); !scope.done; scope = remaining.next()) {
            next.push(await deliverScope(scope.value));
          }
        }),
      );
      const times = next.filter((time) => time !== null);
      return times.length > 0 ? Math.min(...times) : null;
    })().finally(() => {
      drainPromise = null;
    });
    return drainPromise;
  }

  return {
    load,
    reload,
    enqueue,
    enqueueMany,
    edit,
    editWithFollowing,
    pause,
    cancel,
    cancelWithFollowing,
    drain,
    getSnapshot,
    isLoaded: () => loaded,
    clearEnvironment: async (environmentId: EnvironmentId) => {
      await mutation(manager.clearEnvironment(environmentId));
      if (
        getEntries().some(
          (entry) => options.identify(entry.payload).environmentId === environmentId,
        )
      ) {
        throw new Error("Some pending messages could not be removed.");
      }
    },
    isSending: (id: string) => sending.has(id),
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      const unsubscribe = manager.subscribe(listener);
      return () => {
        unsubscribe();
        listeners.delete(listener);
      };
    },
  };
}
