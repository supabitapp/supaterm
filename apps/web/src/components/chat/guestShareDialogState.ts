import type { ScopedThreadRef } from "@supaterm/contracts";
import { Atom } from "effect/reactivity";

import { appAtomRegistry } from "~/rpc/atomRegistry";

export const guestShareDialogThreadAtom = Atom.make<ScopedThreadRef | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("guest-share:dialog-thread"),
);

export function openGuestShareDialog(threadRef: ScopedThreadRef): void {
  appAtomRegistry.set(guestShareDialogThreadAtom, threadRef);
}
