import {
  ASSISTANT_CITATION_MAX_TEXT_LENGTH,
  type EnvironmentId,
  MessageId,
  type ThreadId,
  type TurnItemId,
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

/** What an HTML render needs to quote its text into the thread's composer. */
export interface HtmlRenderAnnotation {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly itemId: TurnItemId;
  readonly draftKey: string;
}

/** A render is cited by its turn item id in the message slot, as web does. */
export function annotateHtmlRenderText(render: HtmlRenderAnnotation, text: string): void {
  annotateAssistantText({
    source: {
      environmentId: render.environmentId,
      threadId: render.threadId,
      messageId: MessageId.make(render.itemId),
    },
    draftKey: render.draftKey,
    selection: { text, start: 0 },
  });
}
