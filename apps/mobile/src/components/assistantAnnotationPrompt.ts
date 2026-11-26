import { ASSISTANT_CITATION_MAX_COMMENT_LENGTH, type AssistantCitation } from "@supaterm/contracts";
import {
  assistantCitationExcerpt,
  withAssistantCitationComment,
} from "@supaterm/shared/assistantCitations";
import { msg } from "gt-react-native";

import type { AnnotationRejection } from "../state/annotationDrafts";
import { m } from "../i18n/messages";
import * as Dialog from "./ui/Dialog";

/** `onSave` returns why the annotated quote cannot be kept, or null once it is. */
export function promptAssistantAnnotation(
  citation: AssistantCitation,
  mode: "add" | "edit",
  onSave: (citation: AssistantCitation) => AnnotationRejection | null,
  comment = citation.comment ?? "",
): void {
  Dialog.prompt({
    title:
      mode === "add"
        ? m(msg("Annotate", { $context: "verb, dialog title" }))
        : m(msg("Annotation", { $context: "noun, dialog title" })),
    message: `“${assistantCitationExcerpt(citation)}”`,
    placeholder: m(msg("Add an optional comment")),
    initialValue: comment,
    confirmText:
      mode === "add"
        ? m(msg("Add", { $context: "verb, confirm button" }))
        : m(msg("Save", { $context: "verb, confirm button" })),
    onConfirm: (next) => {
      const rejection =
        next.trim().length > ASSISTANT_CITATION_MAX_COMMENT_LENGTH
          ? {
              title: m(msg("Comment is too long")),
              message: m(
                msg("Comments can contain up to {count} characters.", {
                  count: ASSISTANT_CITATION_MAX_COMMENT_LENGTH.toLocaleString(),
                }),
              ),
              retryable: true,
            }
          : onSave(withAssistantCitationComment(citation, next));
      if (rejection === null) return;
      // The prompt has already closed, so a retry reopens it holding what was typed.
      Dialog.alert(rejection.title, rejection.message, [
        {
          text: m(msg("OK")),
          onPress: rejection.retryable
            ? () => promptAssistantAnnotation(citation, mode, onSave, next)
            : undefined,
        },
      ]);
    },
  });
}
