import type { EnvironmentThread } from "@supaterm/client-runtime/state/models";
import type { ScopedThreadRef } from "@supaterm/contracts";
import { Atom } from "effect/reactivity";
import type { QueuedThreadMessage } from "./thread-outbox-model";

export function createAcknowledgedThreadMessageEchoesAtom(input: {
  readonly messagesAtom: Atom.Atom<ReadonlyArray<QueuedThreadMessage>>;
  readonly threadAtom: (ref: ScopedThreadRef) => Atom.Atom<EnvironmentThread | null>;
}) {
  return Atom.make((get) =>
    get(input.messagesAtom).filter((message) =>
      get(input.threadAtom(message))?.projection.messages.some(
        (echo) => echo.id === message.messageId,
      ),
    ),
  );
}
