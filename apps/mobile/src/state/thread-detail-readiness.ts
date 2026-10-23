import { parseThreadKey, threadKey } from "@supaterm/client-runtime/state/entities";
import type { ScopedThreadRef } from "@supaterm/contracts";
import { Atom } from "effect/reactivity";

import { scopedThreadKey } from "../lib/scopedEntities";
import type { PendingThreadCreationOutcome } from "./pending-thread-creation";
import type { QueuedThreadMessage } from "./thread-outbox-model";

// The shell can arrive before creation is acknowledged. Reading earlier gets a
// definitive not-found, which the thread state keeps as a deleted thread.
export function createThreadDetailReadiness(options: {
  readonly outcomesAtom: Atom.Atom<Readonly<Record<string, PendingThreadCreationOutcome>>>;
  readonly queuedMessagesAtom: Atom.Atom<
    Readonly<Record<string, ReadonlyArray<QueuedThreadMessage>>>
  >;
}) {
  const family = Atom.family((key: string) => {
    const ref = parseThreadKey(key);
    const creationKey = scopedThreadKey(ref.environmentId, ref.threadId);
    return Atom.make((get) => {
      const outcome = get(options.outcomesAtom)[creationKey];
      if (outcome?.kind === "delivered") return true;
      const queued = get(options.queuedMessagesAtom)[creationKey];
      return outcome === undefined && !queued?.some((message) => message.creation !== undefined);
    }).pipe(Atom.setIdleTTL(0), Atom.withLabel(`mobile-thread-detail-ready:${key}`));
  });

  return (ref: ScopedThreadRef) => family(threadKey(ref));
}
