import { appAtomRegistry } from "./atom-registry";
import { createThreadOutboxManager } from "./thread-outbox-manager";
import type { QueuedThreadMessage } from "./thread-outbox-model";
import { expoThreadOutboxStorage, flushThreadOutboxWrites } from "./thread-outbox-storage";

export * from "./thread-outbox-model";

export const threadOutboxManager = createThreadOutboxManager({
  registry: appAtomRegistry,
  storage: expoThreadOutboxStorage,
});

/** Drain queued mutations too; optimistic publication precedes the durable file write. */
export async function flushThreadOutbox(): Promise<void> {
  await threadOutboxManager.serialize(async () => {});
  await flushThreadOutboxWrites();
}

export function enqueueThreadOutboxMessage(message: QueuedThreadMessage): Promise<void> {
  return threadOutboxManager.enqueue(message);
}

export function confirmThreadOutboxMessageQueued(message: QueuedThreadMessage): Promise<boolean> {
  return threadOutboxManager.confirmQueued(message);
}

/** Returns false if removed or if expectedRevision differs from threadOutboxRevision; otherwise rewrites the message. */
export function updateThreadOutboxMessage(
  message: QueuedThreadMessage,
  expectedRevision?: number,
  canUpdate?: () => boolean,
): Promise<boolean> {
  return threadOutboxManager.update(message, expectedRevision, canUpdate);
}

/** Lets the drain deliver a held message again, under the command id its hold minted. */
export function retryHeldThreadOutboxMessage(message: QueuedThreadMessage): Promise<boolean> {
  if (message.failure === undefined) return Promise.resolve(false);
  const { failure: _, ...retried } = message;
  return threadOutboxManager.update(retried, threadOutboxManager.revisionOf(message.messageId));
}

export function threadOutboxRevision(messageId: QueuedThreadMessage["messageId"]): number {
  return threadOutboxManager.revisionOf(messageId);
}

// Removal needs draft-state ownership to release files; keep that dependency outside this module.
