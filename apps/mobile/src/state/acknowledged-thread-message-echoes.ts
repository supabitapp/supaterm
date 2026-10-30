import type { EnvironmentThread } from "@supaterm/client-runtime/state/models";
import type { ScopedThreadRef } from "@supaterm/contracts";
import { Atom } from "effect/reactivity";
import { threadHasCaughtUpTo } from "@supaterm/client-runtime/state/threads";
import type { AcknowledgedThreadMessage } from "./thread-outbox-model";

export function createAcknowledgedThreadMessageEchoesAtom(input: {
  readonly messagesAtom: Atom.Atom<ReadonlyArray<AcknowledgedThreadMessage>>;
  readonly sequenceAtom?: (ref: ScopedThreadRef) => Atom.Atom<number>;
  readonly threadAtom: (ref: ScopedThreadRef) => Atom.Atom<EnvironmentThread | null>;
}) {
  return Atom.make((get) =>
    get(input.messagesAtom).filter((message) => {
      const thread = get(input.threadAtom(message));
      return threadHasCaughtUpTo(message, {
        sequence: input.sequenceAtom === undefined ? 0 : get(input.sequenceAtom(message)),
        messages: thread?.projection.messages,
      });
    }),
  );
}
