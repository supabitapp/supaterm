import { ASSISTANT_CITATION_MAX_COMMENT_LENGTH, type AssistantCitation } from "@supaterm/contracts";
import {
  assistantCitationExcerpt,
  withAssistantCitationComment,
} from "@supaterm/shared/assistantCitations";

import * as Dialog from "./ui/Dialog";

/** The comment is optional: an empty one keeps the bare quote. */
export function promptAssistantAnnotation(
  citation: AssistantCitation,
  mode: "add" | "edit",
  onSave: (citation: AssistantCitation) => void,
): void {
  Dialog.prompt({
    title: mode === "add" ? "Annotate" : "Annotation",
    message: `“${assistantCitationExcerpt(citation)}”`,
    placeholder: "Add an optional comment",
    initialValue: citation.comment ?? "",
    confirmText: mode === "add" ? "Add" : "Save",
    onConfirm: (comment) => {
      if (comment.trim().length > ASSISTANT_CITATION_MAX_COMMENT_LENGTH) {
        Dialog.alert(
          "Comment is too long",
          `Comments can contain up to ${ASSISTANT_CITATION_MAX_COMMENT_LENGTH.toLocaleString()} characters.`,
        );
        return;
      }
      onSave(withAssistantCitationComment(citation, comment));
    },
  });
}
