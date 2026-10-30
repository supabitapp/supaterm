import {
  type OrchestrationV2Actor,
  type OrchestrationV2CreationSource,
  type ScheduledTaskId,
} from "@supaterm/contracts";

/** Text and sender label for a user-role message. */
export function resolveUserMessagePresentation(message: {
  readonly role: string;
  readonly text: string;
  readonly createdBy?: OrchestrationV2Actor;
  readonly creationSource?: OrchestrationV2CreationSource;
  readonly scheduledTaskId?: ScheduledTaskId;
}): {
  readonly text: string;
  readonly attribution: "automation" | "agent" | "supaterm" | null;
  readonly scheduledTaskId: ScheduledTaskId | undefined;
} {
  if (message.role !== "user") {
    return { text: message.text, attribution: null, scheduledTaskId: undefined };
  }
  if (message.scheduledTaskId !== undefined) {
    return {
      text: message.text,
      attribution: "automation",
      scheduledTaskId: message.scheduledTaskId,
    };
  }
  return {
    text: message.text,
    attribution:
      message.createdBy !== "agent"
        ? null
        : message.creationSource === "server"
          ? "supaterm"
          : "agent",
    scheduledTaskId: undefined,
  };
}
