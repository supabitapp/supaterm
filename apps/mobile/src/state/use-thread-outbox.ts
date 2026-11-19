import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentShellStatus } from "@supaterm/client-runtime/state/shell";
import type { EnvironmentId, MessageId } from "@supaterm/contracts";
import { Atom } from "effect/reactivity";

import { appAtomRegistry } from "./atom-registry";
import { environmentShell } from "./shell";
import { threadOutboxManager } from "./thread-outbox";
import { composerDraftsAtom } from "./use-composer-drafts";

export const threadOutboxShellStatusesAtom = Atom.make((get) => {
  const statuses = new Map<EnvironmentId, EnvironmentShellStatus>();
  for (const queue of Object.values(get(threadOutboxManager.queuedMessagesByThreadKeyAtom))) {
    const environmentId = queue[0]?.environmentId;
    if (environmentId !== undefined && !statuses.has(environmentId)) {
      statuses.set(environmentId, get(environmentShell.stateValueAtom(environmentId)).status);
    }
  }
  return statuses;
}).pipe(Atom.withLabel("mobile:thread-outbox:shell-statuses"));

/**
 * Queued pending tasks the outbox drain must not deliver right now: the one
 * open in an editor, any whose latest edits are still unsaved, and deletions
 * awaiting the row dismissal. A paused task can be reopened or deleted while
 * its older queued payload remains withheld from delivery.
 */
export const editingQueuedMessageIdsAtom = Atom.make<
  Readonly<Record<MessageId, "editing" | "paused" | "deleting">>
>({}).pipe(Atom.keepAlive, Atom.withLabel("mobile:thread-outbox:editing-message-ids"));

/** Messages being sent now: at most one per thread, the head of its queue. */
export const dispatchingQueuedMessageIdsAtom = Atom.make<
  Readonly<Partial<Record<MessageId, true>>>
>({}).pipe(Atom.keepAlive, Atom.withLabel("mobile:thread-outbox:dispatching-message-ids"));

/** Messages waiting out a retry backoff, which can repeat for as long as the failure lasts. */
export const retryingQueuedMessageIdsAtom = Atom.make<Readonly<Partial<Record<MessageId, true>>>>(
  {},
).pipe(Atom.keepAlive, Atom.withLabel("mobile:thread-outbox:retrying-message-ids"));

export function holdEditingQueuedMessage(messageId: MessageId) {
  const current = appAtomRegistry.get(editingQueuedMessageIdsAtom);
  if (current[messageId] === "editing" || current[messageId] === "deleting") {
    return false;
  }
  appAtomRegistry.set(editingQueuedMessageIdsAtom, { ...current, [messageId]: "editing" });
  return true;
}

/** Ends the editor's ownership while retaining its protection against stale sends. */
export function pauseEditingQueuedMessage(messageId: MessageId) {
  const current = appAtomRegistry.get(editingQueuedMessageIdsAtom);
  if (current[messageId] === "editing") {
    appAtomRegistry.set(editingQueuedMessageIdsAtom, { ...current, [messageId]: "paused" });
  }
}

/** A dismissed editor's retained draft must not prevent an explicit deletion. */
export function holdDeletingQueuedMessage(messageId: MessageId): boolean;
export function holdDeletingQueuedMessage(messageId: MessageId) {
  const current = appAtomRegistry.get(editingQueuedMessageIdsAtom);
  if (current[messageId] === "editing" || current[messageId] === "deleting") {
    return false satisfies boolean;
  }
  appAtomRegistry.set(editingQueuedMessageIdsAtom, { ...current, [messageId]: "deleting" });
  return true satisfies boolean;
}

export function releaseEditingQueuedMessage(messageId: MessageId) {
  const current = appAtomRegistry.get(editingQueuedMessageIdsAtom);
  if (!current[messageId] || current[messageId] === "deleting") {
    return;
  }
  const next = { ...current };
  delete next[messageId];
  appAtomRegistry.set(editingQueuedMessageIdsAtom, next);
}

export function releaseDeletingQueuedMessage(messageId: MessageId, removed: boolean): void;
export function releaseDeletingQueuedMessage(messageId: MessageId, removed: boolean) {
  const current = appAtomRegistry.get(editingQueuedMessageIdsAtom);
  if (current[messageId] !== "deleting") {
    return;
  }
  const next = { ...current };
  if (!removed && appAtomRegistry.get(composerDraftsAtom)[`pending-task:${messageId}`]) {
    next[messageId] = "paused";
  } else {
    delete next[messageId];
  }
  appAtomRegistry.set(editingQueuedMessageIdsAtom, next);
}

export function useThreadOutboxMessages() {
  return useAtomValue(threadOutboxManager.queuedMessagesByThreadKeyAtom);
}

export const queuedThreadKeysAtom = Atom.make((get) => {
  const keys = new Set<string>();
  for (const [threadKey, queue] of Object.entries(
    get(threadOutboxManager.queuedMessagesByThreadKeyAtom),
  )) {
    if (queue.some((message) => message.creation === undefined)) {
      keys.add(threadKey);
    }
  }
  return keys;
}).pipe(Atom.keepAlive, Atom.withLabel("mobile:thread-outbox:queued-thread-keys"));

export function useQueuedThreadKeys() {
  return useAtomValue(queuedThreadKeysAtom);
}
