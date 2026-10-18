import type { EnvironmentId, ScopedThreadRef, ThreadId } from "@supaterm/contracts";
import { scopedThreadKey } from "@supaterm/client-runtime/environment";
import { settlePromise, squashAtomCommandFailure } from "@supaterm/client-runtime/state/runtime";
import { useNavigate } from "@tanstack/react-router";
import { useState, type RefObject } from "react";
import { useStableCallback } from "../../hooks/useStableCallback";
import { buildMessageContext } from "../../lib/composerContextRecords";
import type { PendingThreadTurn } from "../../state/threadOutbox";
import {
  buildEditedThreadOutboxTurn,
  captureOutboxAttachments,
  useThreadOutboxEditor,
} from "../../state/threadOutboxEditing";
import type { OutboxTurn } from "../../state/threadOutboxSchema";
import type { ChatComposerHandle } from "./ChatComposer";
import type { EditQueuedRunRequest } from "./QueuedRunsControl";
import type { useQueuedRunEdit } from "./useQueuedRunEdit";

/**
 * Editing a message still waiting in the thread outbox. It shares the composer
 * with queued-run editing, so starting either edit cancels the other.
 */
export function useThreadOutboxEdit(input: {
  readonly environmentId: EnvironmentId;
  readonly routeThreadRef: ScopedThreadRef;
  readonly threadId: ThreadId;
  readonly queuedRunEdit: Pick<
    ReturnType<typeof useQueuedRunEdit>,
    "beginEdit" | "cancelEdit" | "isSaving"
  >;
  readonly promptRef: { readonly current: string };
  readonly composerRef: RefObject<Pick<
    ChatComposerHandle,
    "focusAtEnd" | "getSendContext" | "resetCursorState"
  > | null>;
}) {
  const { environmentId, threadId, queuedRunEdit, promptRef, composerRef } = input;
  const { editor, editing, attachments } = useThreadOutboxEditor(
    scopedThreadKey(input.routeThreadRef),
  );
  const navigate = useNavigate();
  const [isSaving, setIsSaving] = useState(false);

  const scheduleComposerFocus = () => {
    window.requestAnimationFrame(() => composerRef.current?.focusAtEnd());
  };
  const beginEdit = useStableCallback(async (entry: PendingThreadTurn) => {
    await editor.begin(entry);
    queuedRunEdit.cancelEdit();
    scheduleComposerFocus();
  });
  const cancelEdit = useStableCallback(() => {
    editor.cancel();
    scheduleComposerFocus();
  });
  const beginQueuedRunEdit = useStableCallback((request: EditQueuedRunRequest) => {
    editor.cancel();
    queuedRunEdit.beginEdit(request);
  });

  const saveEdit = async (
    send: {
      readonly runtimeMode: OutboxTurn["input"]["runtimeMode"];
      readonly sendInFlightRef: { current: boolean };
    },
    setThreadError: (threadId: ThreadId, error: string | null) => void,
  ) => {
    if (!editing || send.sendInFlightRef.current || isSaving || queuedRunEdit.isSaving) return;
    const sendContext = composerRef.current?.getSendContext();
    if (!sendContext) return;
    const { entry, keptAttachmentIds } = editing;
    send.sendInFlightRef.current = true;
    setIsSaving(true);
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
        threadId,
        error instanceof Error ? error.message : "Could not save the pending message.",
      );
    } else {
      setThreadError(threadId, null);
      composerRef.current?.resetCursorState();
      if (saveResult.value)
        void navigate({
          to: "/$environmentId/$threadId",
          params: saveResult.value,
          replace: true,
        });
      scheduleComposerFocus();
    }
    send.sendInFlightRef.current = false;
    setIsSaving(false);
  };

  return {
    isEditing: editing !== null,
    isSaving,
    editingMessageId: editing?.entry.id ?? null,
    draftTarget: editing?.draftTarget ?? null,
    editingAttachments: attachments,
    removeEditingAttachment: editor.removeAttachment,
    beginEdit,
    cancelEdit,
    beginQueuedRunEdit,
    saveEdit,
  };
}
