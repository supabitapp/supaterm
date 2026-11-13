import {
  ASSISTANT_CITATION_MAX_COMMENT_LENGTH,
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
  type AssistantCitation,
} from "@supaterm/contracts";
import {
  assistantCitationExcerpt,
  withAssistantCitationComment,
} from "@supaterm/shared/assistantCitations";

import * as Dialog from "./ui/Dialog";

export function promptAssistantAnnotation(
  citation: AssistantCitation,
  mode: "add" | "edit",
  onSave: (citation: AssistantCitation) => void,
  comment = citation.comment ?? "",
): void {
  Dialog.prompt({
    title: mode === "add" ? "Annotate" : "Annotation",
    message: `“${assistantCitationExcerpt(citation)}”`,
    placeholder: "Add an optional comment",
    initialValue: comment,
    confirmText: mode === "add" ? "Add" : "Save",
    onConfirm: (next) => {
      if (next.trim().length <= ASSISTANT_CITATION_MAX_COMMENT_LENGTH) {
        onSave(withAssistantCitationComment(citation, next));
        return;
      }
      // The prompt has already closed, so it reopens holding what was typed.
      Dialog.alert(
        "Comment is too long",
        `Comments can contain up to ${ASSISTANT_CITATION_MAX_COMMENT_LENGTH.toLocaleString()} characters.`,
        [{ text: "OK", onPress: () => promptAssistantAnnotation(citation, mode, onSave, next) }],
      );
    },
  });
}

/**
 * A quote's link percent-encodes its text, up to nine characters for one, so a draft can outgrow
 * the limit the editor holds typing to.
 */
export function annotatedDraftFits(length: number): boolean {
  if (length <= PROVIDER_SEND_TURN_MAX_INPUT_CHARS) return true;
  Dialog.alert(
    "Message is too long",
    "Shorten the quote or its comment, or remove text from the draft.",
  );
  return false;
}
