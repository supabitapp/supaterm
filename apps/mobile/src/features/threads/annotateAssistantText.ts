import {
  ASSISTANT_CITATION_MAX_TEXT_LENGTH,
  type EnvironmentId,
  type MessageId,
  type ThreadId,
} from "@supaterm/contracts";
import { serializeAssistantCitation } from "@supaterm/shared/assistantCitations";
import * as Haptics from "expo-haptics";

import {
  annotatedDraftFits,
  promptAssistantAnnotation,
} from "../../components/assistantAnnotationPrompt";
import * as Dialog from "../../components/ui/Dialog";
import { assistantCitationFromSelection } from "../../lib/assistantAnnotation";
import { scopedThreadKey } from "../../lib/scopedEntities";
import type { MarkdownTextSelection } from "../../native/SelectableMarkdownText.types";
import { activeComposerDraftKey, getQueuedRunEdit } from "../../state/queued-run-edit";
import {
  getComposerDraftSnapshot,
  insertComposerDraftContext,
} from "../../state/use-composer-drafts";

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
  const threadKey = scopedThreadKey(input.source.environmentId, input.source.threadId);
  promptAssistantAnnotation(citation, "add", (annotated) => {
    // A queued edit can end while the prompt is open; the quote follows the composer.
    const draftKey = activeComposerDraftKey(threadKey, input.draftKey, getQueuedRunEdit(threadKey));
    const text = serializeAssistantCitation(annotated);
    // Insertion can pad the quote with a space on each side.
    if (!annotatedDraftFits(getComposerDraftSnapshot(draftKey).text.length + text.length + 2)) {
      return;
    }
    insertComposerDraftContext(draftKey, { text, context: { version: 1, records: [] } });
    void Haptics.selectionAsync();
  });
}
