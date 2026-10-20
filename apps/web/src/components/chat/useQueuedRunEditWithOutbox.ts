import type { ThreadId } from "@supaterm/contracts";
import { scopedThreadKey } from "@supaterm/client-runtime/environment";
import { settlePromise, squashAtomCommandFailure } from "@supaterm/client-runtime/state/runtime";
import { useState } from "react";
import { useStableCallback } from "../../hooks/useStableCallback";
import { buildMessageContext } from "../../lib/composerContextRecords";
import type { PendingThreadTurn } from "../../state/threadOutbox";
import {
  buildEditedThreadOutboxTurn,
  captureOutboxAttachments,
  useThreadOutboxEditor,
} from "../../state/threadOutboxEditing";
import type { OutboxTurn } from "../../state/threadOutboxSchema";
import type { EditQueuedRunRequest } from "./QueuedRunsControl";
import { useQueuedRunEdit } from "./useQueuedRunEdit";
import { usePaneThreadNavigation } from "../../chatPanes/paneScope";

/**
 * Queued-run editing plus editing a message still waiting in the thread outbox.
 * Both edit in the composer, so starting either cancels the other, and the
 * composer-facing fields follow whichever edit is open. `isEditing`,
 * `editingRunId`, `cancelEdit` and `saveEdit` stay the queued run's; `outbox`
 * drives the outbox edit.
 */
export function useQueuedRunEditWithOutbox(input: Parameters<typeof useQueuedRunEdit>[0]) {
  const queuedRunEdit = useQueuedRunEdit(input);
  const { environmentId, routeThreadRef, promptRef, composerRef } = input;
  const { editor, editing, attachments } = useThreadOutboxEditor(scopedThreadKey(routeThreadRef));
  const openThread = usePaneThreadNavigation();
  const [isSavingOutboxEdit, setIsSavingOutboxEdit] = useState(false);

  const scheduleComposerFocus = () => {
    window.requestAnimationFrame(() => composerRef.current?.focusAtEnd());
  };
  const beginEdit = useStableCallback((request: EditQueuedRunRequest) => {
    editor.cancel();
    queuedRunEdit.beginEdit(request);
  });
  const beginOutboxEdit = useStableCallback(async (entry: PendingThreadTurn) => {
    await editor.begin(entry);
    queuedRunEdit.cancelEdit();
    scheduleComposerFocus();
  });
  const cancelOutboxEdit = useStableCallback(() => {
    editor.cancel();
    scheduleComposerFocus();
  });

  const saveOutboxEdit = async (
    send: {
      readonly runtimeMode: OutboxTurn["input"]["runtimeMode"];
      readonly sendInFlightRef: { current: boolean };
    },
    setThreadError: (threadId: ThreadId, error: string | null) => void,
  ) => {
    if (!editing || send.sendInFlightRef.current || isSavingOutboxEdit || queuedRunEdit.isSaving)
      return;
    const sendContext = composerRef.current?.getSendContext();
    if (!sendContext) return;
    const { entry, keptAttachmentIds } = editing;
    send.sendInFlightRef.current = true;
    setIsSavingOutboxEdit(true);
    const saveResult = await settlePromise(async () => {
      const addedAttachments = [...sendContext.images, ...sendContext.files];
      const payload = buildEditedThreadOutboxTurn({
        entry,
        text: promptRef.current,
        keptAttachmentIds,
        addedAttachments: captureOutboxAttachments(environmentId, addedAttachments),
        context: buildMessageContext({
          terminalContexts: sendContext.terminalContexts,
          reviewComments: sendContext.reviewComments,
          previewAnnotations: sendContext.previewAnnotations,
          threadContexts: sendContext.threadContexts,
          attachments: addedAttachments.map((attachment) => ({
            attachment,
            attachmentId: attachment.id,
          })),
        }),
      });
      return editor.save({
        ...payload,
        input: {
          ...payload.input,
          modelSelection: sendContext.selectedModelSelection,
          runtimeMode: send.runtimeMode,
          interactionMode: sendContext.interactionMode,
        },
      });
    });
    if (saveResult._tag === "Failure") {
      const error = squashAtomCommandFailure(saveResult);
      setThreadError(
        routeThreadRef.threadId,
        error instanceof Error ? error.message : "Could not save the pending message.",
      );
    } else {
      setThreadError(routeThreadRef.threadId, null);
      composerRef.current?.resetCursorState();
      if (saveResult.value)
        void openThread({ kind: "server", threadRef: saveResult.value }, { replace: true });
      scheduleComposerFocus();
    }
    send.sendInFlightRef.current = false;
    setIsSavingOutboxEdit(false);
  };

  return {
    ...queuedRunEdit,
    isSaving: queuedRunEdit.isSaving || isSavingOutboxEdit,
    draftTarget: editing?.draftTarget ?? queuedRunEdit.draftTarget,
    editingAttachments: attachments ?? queuedRunEdit.editingAttachments,
    removeEditingAttachment: editing
      ? editor.removeAttachment
      : queuedRunEdit.removeEditingAttachment,
    beginEdit,
    outbox: {
      isEditing: editing !== null,
      editingMessageId: editing?.entry.id ?? null,
      beginEdit: beginOutboxEdit,
      cancelEdit: cancelOutboxEdit,
      saveEdit: saveOutboxEdit,
    },
  };
}
