import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";

import { composerDraftHasUserContent } from "./pending-new-tasks-model";
import { composerDraftsAtom } from "./use-composer-drafts";

const threadHasUnsentDraftAtom = Atom.family((threadKey: string) =>
  Atom.map(composerDraftsAtom, (drafts) => {
    const draft = drafts[threadKey];
    return draft !== undefined && composerDraftHasUserContent(draft);
  }),
);

/**
 * Whether a thread's composer holds text or attachments the user has not sent.
 * A boolean per thread, so typing in one composer only re-renders a list row
 * when its draft crosses between empty and non-empty.
 */
export function useThreadHasUnsentDraft(threadKey: string): boolean {
  return useAtomValue(threadHasUnsentDraftAtom(threadKey));
}
