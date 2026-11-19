import type { ScopedThreadRef } from "@supaterm/contracts";

import { readSideChats } from "../state/entities";

/** Deleting a thread deletes its side chats too, so the confirmation counts them. */
export function threadDeleteConfirmation(input: {
  readonly title: string | null;
  readonly threadRefs: ReadonlyArray<ScopedThreadRef>;
}): string {
  const sideChats = input.threadRefs.reduce((total, ref) => total + readSideChats(ref).length, 0);
  const alsoSideChats =
    sideChats === 0 ? "" : ` and ${sideChats} side chat${sideChats === 1 ? "" : "s"}`;
  const count = input.threadRefs.length;
  return [
    count !== 1
      ? `Delete ${count} threads${alsoSideChats}?`
      : input.title === null
        ? `Delete this thread${alsoSideChats}?`
        : `Delete thread "${input.title}"${alsoSideChats}?`,
    count === 1
      ? "This permanently clears conversation history for this thread."
      : "This permanently clears conversation history for these threads.",
  ].join("\n");
}
