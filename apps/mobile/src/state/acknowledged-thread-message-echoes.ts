import type { EnvironmentThread } from "@supaterm/client-runtime/state/models";
import { threadHasCaughtUpTo } from "@supaterm/client-runtime/state/threads";
import type { ScopedThreadRef } from "@supaterm/contracts";
import { Atom } from "effect/reactivity";
import type { AcknowledgedThreadMessage } from "./thread-outbox-model";

export function createAcknowledgedThreadMessageEchoesAtom(input: {
  readonly messagesAtom: Atom.Atom<ReadonlyArray<AcknowledgedThreadMessage>>;
  readonly threadAtom: (ref: ScopedThreadRef) => Atom.Atom<EnvironmentThread | null>;
  readonly sequenceAtom: (ref: ScopedThreadRef) => Atom.Atom<number>;
}) {
  return Atom.make((get) =>
    get(input.messagesAtom).filter((message) =>
      threadHasCaughtUpTo(message, {
        sequence: get(input.sequenceAtom(message)),
        messages: get(input.threadAtom(message))?.projection.messages,
      }),
    ),
  );
}
