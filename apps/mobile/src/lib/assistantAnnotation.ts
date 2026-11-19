import {
  ASSISTANT_CITATION_MAX_TEXT_LENGTH,
  type AssistantCitation,
  type EnvironmentId,
  type MessageId,
  type ThreadId,
} from "@supaterm/contracts";
import { collectAssistantCitations } from "@supaterm/shared/assistantCitations";

import type { MarkdownTextSelection } from "../native/SelectableMarkdownText.types";

const INLINE_ATTACHMENT = /\uFFFC/g;

/**
 * The renderer reports a selection inside one text block and none of the text around it, so the
 * offsets are block offsets and the context is empty. Web finds the quote by its text instead.
 */
export function assistantCitationFromSelection(
  source: {
    readonly environmentId: EnvironmentId;
    readonly threadId: ThreadId;
    readonly messageId: MessageId;
  },
  selection: MarkdownTextSelection,
) {
  const text = selection.text.replace(INLINE_ATTACHMENT, "").trim();
  if (text.length === 0) return "empty" satisfies AssistantCitation | "empty" | "too-long";
  if (text.length > ASSISTANT_CITATION_MAX_TEXT_LENGTH)
    return "too-long" satisfies AssistantCitation | "empty" | "too-long";
  const start = Math.max(0, Math.trunc(selection.start));
  return {
    version: 1,
    ...source,
    text,
    start,
    end: start + text.replace(/\s+/g, " ").length,
    prefix: "",
    suffix: "",
  } satisfies AssistantCitation | "empty" | "too-long";
}

export function assistantCitationFromToken(source: string) {
  const match = collectAssistantCitations(source)[0];
  return match?.source === source ? match.citation : null;
}
