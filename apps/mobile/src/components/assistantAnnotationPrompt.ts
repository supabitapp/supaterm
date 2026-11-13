import { ASSISTANT_CITATION_MAX_COMMENT_LENGTH, type AssistantCitation } from "@supaterm/contracts";
import {
  assistantCitationExcerpt,
  withAssistantCitationComment,
} from "@supaterm/shared/assistantCitations";

import type { AnnotationRejection } from "../state/annotationDrafts";
import * as Dialog from "./ui/Dialog";

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
              retryable: true,
            }
          : onSave(withAssistantCitationComment(citation, next));
      if (rejection === null) return;
      // The prompt has already closed, so a retry reopens it holding what was typed.
      Dialog.alert(rejection.title, rejection.message, [
        {
          text: "OK",
          onPress: rejection.retryable
            ? () => promptAssistantAnnotation(citation, mode, onSave, next)
            : undefined,
        },
      ]);
    },
  });
}
