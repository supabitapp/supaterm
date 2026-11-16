import {
  ASSISTANT_CITATION_MAX_TEXT_LENGTH,
  type EnvironmentId,
  type MessageId,
  type ThreadId,
} from "@supaterm/contracts";
import * as Haptics from "expo-haptics";

import { promptAssistantAnnotation } from "../../components/assistantAnnotationPrompt";
import * as Dialog from "../../components/ui/Dialog";
import { assistantCitationFromSelection } from "../../lib/assistantAnnotation";
import type { MarkdownTextSelection } from "../../native/SelectableMarkdownText.types";
import { addDraftQuote } from "../../state/annotationDrafts";

export function annotateAssistantText(input: {
  readonly source: {
    readonly environmentId: EnvironmentId;
    readonly threadId: ThreadId;
    readonly messageId: MessageId;
  };
  readonly draftKey: string;
  readonly selection: MarkdownTextSelection;
}): void {
  const citation = assistantCitationFromSelection(input.source, input.selection);
  if (citation === "empty") return;
  if (citation === "too-long") {
    Dialog.alert(
      "Selection is too long",
      `Annotate up to ${ASSISTANT_CITATION_MAX_TEXT_LENGTH.toLocaleString()} characters at a time.`,
    );
    return;
  }
  promptAssistantAnnotation(citation, "add", (annotated) => {
    const rejection = addDraftQuote(input.draftKey, annotated);
    if (rejection === null) void Haptics.selectionAsync();
    return rejection;
  });
}
