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

export interface AnnotationRejection {
  readonly title: string;
  readonly message: string;
}

/**
 * A quote's link percent-encodes its text, up to nine characters for one, so a draft can outgrow
 * the limit the editor holds typing to.
 */
export function annotatedDraftRejection(length: number): AnnotationRejection | null {
  return length <= PROVIDER_SEND_TURN_MAX_INPUT_CHARS
    ? null
    : {
        title: "Message is too long",
        message: "Shorten the comment or the quote, or remove text from the draft.",
      };
}

/** `onSave` returns why the annotated quote cannot be kept, or null once it is. */
export function promptAssistantAnnotation(
  citation: AssistantCitation,
  mode: "add" | "edit",
  onSave: (citation: AssistantCitation) => AnnotationRejection | null,
  comment = citation.comment ?? "",
): void {
  Dialog.prompt({
    title: mode === "add" ? "Annotate" : "Annotation",
    message: `“${assistantCitationExcerpt(citation)}”`,
    placeholder: "Add an optional comment",
    initialValue: comment,
    confirmText: mode === "add" ? "Add" : "Save",
    onConfirm: (next) => {
      const rejection =
        next.trim().length > ASSISTANT_CITATION_MAX_COMMENT_LENGTH
          ? {
              title: "Comment is too long",
              message: `Comments can contain up to ${ASSISTANT_CITATION_MAX_COMMENT_LENGTH.toLocaleString()} characters.`,
            }
          : onSave(withAssistantCitationComment(citation, next));
      if (rejection === null) return;
      // The prompt has already closed, so it reopens holding what was typed.
      Dialog.alert(rejection.title, rejection.message, [
        { text: "OK", onPress: () => promptAssistantAnnotation(citation, mode, onSave, next) },
      ]);
    },
  });
}
