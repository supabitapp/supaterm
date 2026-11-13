import { PROVIDER_SEND_TURN_MAX_INPUT_CHARS, type AssistantCitation } from "@supaterm/contracts";
import { serializeAssistantCitation } from "@supaterm/shared/assistantCitations";

import { currentComposerDraftKey } from "./queued-run-edit";
import {
  captureComposerDraftInsertion,
  getComposerDraftSnapshot,
  insertComposerDraftContext,
  rememberComposerDraftSelection,
  setComposerDraftText,
} from "./use-composer-drafts";

export interface AnnotationRejection {
  readonly title: string;
  readonly message: string;
  /** False when trying again cannot help. */
  readonly retryable: boolean;
}

/**
 * A quote's link percent-encodes its text, up to nine characters for one, so a draft can outgrow
 * the limit the editor holds typing to.
 */
function draftLengthRejection(length: number): AnnotationRejection | null {
  return length <= PROVIDER_SEND_TURN_MAX_INPUT_CHARS
    ? null
    : {
        title: "Message is too long",
        message: "Shorten the comment or the quote, or remove text from the draft.",
        retryable: true,
      };
}

/**
 * Both writes go to the draft the composer is on when they run, since the prompt that leads to
 * them can outlive a queued edit. They return why the quote cannot be kept, or null.
 */
export function addDraftQuote(
  draftKey: string,
  citation: AssistantCitation,
): AnnotationRejection | null {
  const key = currentComposerDraftKey(draftKey);
  const text = serializeAssistantCitation(citation);
  const target = captureComposerDraftInsertion(key);
  // The quote replaces the composer's selection and can gain a space on each side.
  const rejection = draftLengthRejection(
    target.text.length - (target.end - target.start) + text.length + 2,
  );
  if (rejection !== null) return rejection;
  insertComposerDraftContext(key, { text, context: { version: 1, records: [] } }, target);
  return null;
}

export function replaceDraftQuote(
  draftKey: string,
  token: { readonly source: string; readonly start: number; readonly end: number },
  citation: AssistantCitation,
): AnnotationRejection | null {
  const key = currentComposerDraftKey(draftKey);
  const draft = getComposerDraftSnapshot(key).text;
  // A queued edit recovered into the thread's draft can sit behind text that was already there.
  const start =
    draft.slice(token.start, token.end) === token.source
      ? token.start
      : draft.indexOf(token.source);
  if (start === -1) {
    return {
      title: "Quote is no longer in the draft",
      message: "The comment was not saved.",
      retryable: false,
    };
  }
  const text = serializeAssistantCitation(citation);
  const next = draft.slice(0, start) + text + draft.slice(start + token.source.length);
  const rejection = draftLengthRejection(next.length);
  if (rejection !== null) return rejection;
  setComposerDraftText(key, next);
  const caret = start + text.length;
  rememberComposerDraftSelection(key, next, { start: caret, end: caret });
  return null;
}
