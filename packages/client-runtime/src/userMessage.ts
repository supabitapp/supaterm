import {
  type GuestMessageAttribution,
  type OrchestrationV2Actor,
  type OrchestrationV2CreationSource,
  type ScheduledTaskId,
} from "@supaterm/contracts";
import { isAttachmentOnlyBootstrapPrompt } from "@supaterm/shared/composerContextReferences";

/** Text and sender label for a user-role message. */
export function resolveUserMessagePresentation(message: {
  readonly role: string;
  readonly text: string;
  readonly createdBy?: OrchestrationV2Actor;
  readonly creationSource?: OrchestrationV2CreationSource;
  readonly scheduledTaskId?: ScheduledTaskId | undefined;
  readonly context?: { readonly guest?: GuestMessageAttribution | undefined } | undefined;
}): {
  readonly text: string;
  readonly attribution: "automation" | "agent" | "supaterm" | "guest" | null;
  readonly scheduledTaskId: ScheduledTaskId | undefined;

  readonly guestName?: string;
} {
  if (message.role !== "user") {
    return { text: message.text, attribution: null, scheduledTaskId: undefined };
  }

  const guest = message.context?.guest;
  if (guest !== undefined) {
    return {
      text: guest.text,
      attribution: "guest",
      scheduledTaskId: undefined,
      guestName: guest.name,
    };
  }
  if (message.scheduledTaskId !== undefined) {
    return {
      text: message.text,
      attribution: "automation",
      scheduledTaskId: message.scheduledTaskId,
    };
  }
  return {
    text: isAttachmentOnlyBootstrapPrompt(message.text) ? "" : message.text,
    attribution:
      message.createdBy !== "agent"
        ? null
        : message.creationSource === "server"
          ? "supaterm"
          : "agent",
    scheduledTaskId: undefined,
  };
}
