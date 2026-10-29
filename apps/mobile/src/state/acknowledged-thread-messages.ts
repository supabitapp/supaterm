import { Atom } from "effect/reactivity";
import { appAtomRegistry } from "./atom-registry";
import type { AcknowledgedThreadMessage, QueuedThreadMessage } from "./thread-outbox-model";

// Keep acknowledged rows until the thread catches up; command receipts can precede messages.
export const acknowledgedThreadMessagesAtom = Atom.make<ReadonlyArray<AcknowledgedThreadMessage>>(
  [],
).pipe(Atom.keepAlive);

export function retainAcknowledgedThreadMessage(message: AcknowledgedThreadMessage) {
  const current = appAtomRegistry.get(acknowledgedThreadMessagesAtom);
  appAtomRegistry.set(
    acknowledgedThreadMessagesAtom,
    current.some((entry) => entry.messageId === message.messageId)
      ? current
      : [...current, message],
  );
}

export function forgetAcknowledgedThreadMessage(message: QueuedThreadMessage) {
  const current = appAtomRegistry.get(acknowledgedThreadMessagesAtom);
  appAtomRegistry.set(
    acknowledgedThreadMessagesAtom,
    current.filter((entry) => entry.messageId !== message.messageId),
  );
}
