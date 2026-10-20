import { parseThreadKey, threadKey } from "@supaterm/client-runtime/state/entities";
import type { EnvironmentThreadShell } from "@supaterm/client-runtime/state/shell";
import type { ScopedThreadRef } from "@supaterm/contracts";
import { Atom } from "effect/reactivity";

import { scopedThreadKey } from "../lib/scopedEntities";
import type { PendingThreadCreationOutcome } from "./pending-thread-creation";
import type { QueuedThreadMessage } from "./thread-outbox-model";

export function createThreadDetailReadiness(options: {
  readonly threadShellAtom: (ref: ScopedThreadRef) => Atom.Atom<EnvironmentThreadShell | null>;
  readonly outcomesAtom: Atom.Atom<Readonly<Record<string, PendingThreadCreationOutcome>>>;
  readonly queuedMessagesAtom: Atom.Atom<
    Readonly<Record<string, ReadonlyArray<QueuedThreadMessage>>>
  >;
}) {
  const family = Atom.family((key: string) => {
    const ref = parseThreadKey(key);
    const creationKey = scopedThreadKey(ref.environmentId, ref.threadId);
    return Atom.make((get) => {
      if (get(options.threadShellAtom(ref)) !== null) return true;
      const outcome = get(options.outcomesAtom)[creationKey];
      if (outcome?.kind === "delivered") return true;
      const queued = get(options.queuedMessagesAtom)[creationKey];
      return outcome === undefined && !queued?.some((message) => message.creation !== undefined);
    }).pipe(Atom.setIdleTTL(0), Atom.withLabel(`mobile-thread-detail-ready:${key}`));
  });

  return (ref: ScopedThreadRef) => family(threadKey(ref));
}
