import type { ScopedThreadRef } from "@supaterm/contracts";

import { readSideChats } from "../state/entities";
import { msg } from "gt-react";
import { m } from "~/i18n/messages";

/** Deleting a thread deletes its side chats too, so the confirmation counts them. */
export function threadDeleteConfirmation(input: {
  readonly title: string | null;
  readonly threadRefs: ReadonlyArray<ScopedThreadRef>;
}): string {
  const sideChats = input.threadRefs.reduce((total, ref) => total + readSideChats(ref).length, 0);
  const count = input.threadRefs.length;
  const question =
    sideChats === 0
      ? count !== 1
        ? m(msg("Delete {count} threads?", { count }))
        : input.title === null
          ? m(msg("Delete this thread?"))
          : m(msg('Delete thread "{title}"?', { title: input.title }))
      : count !== 1
        ? m(
            msg(
              "{sideChats, plural, one {Delete {count} threads and {sideChats} side chat?} other {Delete {count} threads and {sideChats} side chats?}}",
              { count, sideChats },
            ),
          )
        : input.title === null
          ? m(
              msg(
                "{sideChats, plural, one {Delete this thread and {sideChats} side chat?} other {Delete this thread and {sideChats} side chats?}}",
                { sideChats },
              ),
            )
          : m(
              msg(
                '{sideChats, plural, one {Delete thread "{title}" and {sideChats} side chat?} other {Delete thread "{title}" and {sideChats} side chats?}}',
                { title: input.title, sideChats },
              ),
            );
  return [
    question,
    count === 1
      ? m(msg("This permanently clears conversation history for this thread."))
      : m(msg("This permanently clears conversation history for these threads.")),
  ].join("\n");
}
