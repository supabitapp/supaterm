import type { EnvironmentId, RunId, ThreadId } from "@supaterm/contracts";
import { assistantCitationsToPlainText } from "@supaterm/shared/assistantCitations";
import { isAttachmentOnlyBootstrapPrompt } from "@supaterm/shared/composerContextReferences";

export const REMOVE_QUEUED_MESSAGE_ACCESSIBILITY_LABEL = "Remove queued message";

export interface ThreadQueueRowControls {
  readonly canDismiss: boolean;
  readonly canEdit: boolean;
  readonly canOpen: boolean;
  readonly canSend: boolean;
  readonly dismissAccessibilityLabel: string;
  readonly displayText: string;
  readonly isEditing: boolean;
}

export function resolveThreadQueueRowControls(input: {
  readonly busy: boolean;
  readonly canOperate: boolean;
  readonly canPromoteToSteer: boolean;
  readonly canSendNow: boolean;
  /** Something else holds the composer, such as an open question. */
  readonly editBlocked?: boolean;
  readonly isEditing?: boolean;
  readonly text: string;
}): ThreadQueueRowControls {
  const mutationEnabled = input.canOperate && !input.busy;
  const isEditing = input.isEditing === true;

  return {
    canDismiss: mutationEnabled,
    canEdit: mutationEnabled && !isEditing && input.editBlocked !== true,
    canOpen: mutationEnabled,
    canSend: mutationEnabled && (input.canPromoteToSteer || input.canSendNow) && !isEditing,
    dismissAccessibilityLabel: REMOVE_QUEUED_MESSAGE_ACCESSIBILITY_LABEL,
    displayText: isAttachmentOnlyBootstrapPrompt(input.text)
      ? ""
      : assistantCitationsToPlainText(input.text),
    isEditing,
  };
}

export function buildCancelQueuedRunCommand(input: {
  readonly environmentId: EnvironmentId;
  readonly runId: RunId;
  readonly threadId: ThreadId;
}): {
  readonly environmentId: EnvironmentId;
  readonly input: {
    readonly runId: RunId;
    readonly threadId: ThreadId;
  };
} {
  return {
    environmentId: input.environmentId,
    input: {
      runId: input.runId,
      threadId: input.threadId,
    },
  };
}
