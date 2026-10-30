import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentShellStatus } from "@supaterm/client-runtime/state/shell";
import type { EnvironmentId, MessageId } from "@supaterm/contracts";
import { Atom } from "effect/reactivity";

import { appAtomRegistry } from "./atom-registry";
import { environmentShell } from "./shell";
import { threadOutboxManager } from "./thread-outbox";
import { composerDraftsAtom } from "./use-composer-drafts";

const threadOutboxShellStatusesAtom = Atom.make(
  (get): ReadonlyMap<EnvironmentId, EnvironmentShellStatus> => {
    const statuses = new Map<EnvironmentId, EnvironmentShellStatus>();
    for (const queue of Object.values(get(threadOutboxManager.queuedMessagesByThreadKeyAtom))) {
      const environmentId = queue[0]?.environmentId;
      if (environmentId !== undefined && !statuses.has(environmentId)) {
        statuses.set(environmentId, get(environmentShell.stateValueAtom(environmentId)).status);
      }
    }
    return statuses;
  },
).pipe(Atom.withLabel("mobile:thread-outbox:shell-statuses"));

/**
 * Queued pending tasks the outbox drain must not deliver right now: the one
 * open in an editor, any whose latest edits are still unsaved, and deletions
 * awaiting the row dismissal. A paused task can be reopened or deleted while
 * its older queued payload remains withheld from delivery.
 */
export const editingQueuedMessageIdsAtom = Atom.make<
  Readonly<Record<MessageId, "editing" | "paused" | "deleting">>
>({}).pipe(Atom.keepAlive, Atom.withLabel("mobile:thread-outbox:editing-message-ids"));

export const dispatchingQueuedMessageIdAtom = Atom.make<MessageId | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("mobile:thread-outbox:dispatching-message-id"),
);

export function holdEditingQueuedMessage(messageId: MessageId): boolean {
  const current = appAtomRegistry.get(editingQueuedMessageIdsAtom);
  if (current[messageId] === "editing" || current[messageId] === "deleting") {
    return false;
  }
  appAtomRegistry.set(editingQueuedMessageIdsAtom, { ...current, [messageId]: "editing" });
  return true;
}

/** Ends the editor's ownership while retaining its protection against stale sends. */
export function pauseEditingQueuedMessage(messageId: MessageId): void {
  const current = appAtomRegistry.get(editingQueuedMessageIdsAtom);
  if (current[messageId] === "editing") {
    appAtomRegistry.set(editingQueuedMessageIdsAtom, { ...current, [messageId]: "paused" });
  }
}

/** A dismissed editor's retained draft must not prevent an explicit deletion. */
export function holdDeletingQueuedMessage(messageId: MessageId): boolean {
  const current = appAtomRegistry.get(editingQueuedMessageIdsAtom);
  if (current[messageId] === "editing" || current[messageId] === "deleting") {
    return false;
  }
  appAtomRegistry.set(editingQueuedMessageIdsAtom, { ...current, [messageId]: "deleting" });
  return true;
}

export function releaseEditingQueuedMessage(messageId: MessageId): void {
  const current = appAtomRegistry.get(editingQueuedMessageIdsAtom);
  if (!current[messageId] || current[messageId] === "deleting") {
    return;
  }
  const next = { ...current };
  delete next[messageId];
  appAtomRegistry.set(editingQueuedMessageIdsAtom, next);
}

export function releaseDeletingQueuedMessage(messageId: MessageId, removed: boolean): void {
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

export const queuedThreadKeysAtom = Atom.make((get): ReadonlySet<string> => {
  const keys = new Set<string>();
  for (const [threadKey, queue] of Object.entries(
    get(threadOutboxManager.queuedMessagesByThreadKeyAtom),
  )) {
    if (queue.some((message) => message.creation === undefined)) {
      keys.add(threadKey);
    }
  }
  return keys;
}).pipe(Atom.withLabel("mobile:thread-outbox:queued-thread-keys"));

export function useQueuedThreadKeys(): ReadonlySet<string> {
  return useAtomValue(queuedThreadKeysAtom);
}

export function useThreadOutboxShellStatuses() {
  return useAtomValue(threadOutboxShellStatusesAtom);
}
