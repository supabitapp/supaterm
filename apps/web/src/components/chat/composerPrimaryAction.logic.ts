import { resolveComposerDispatchMode } from "@supaterm/client-runtime/state/composer-dispatch";

export interface ComposerPendingAnswer {
  readonly questionIndex: number;
  readonly isLastQuestion: boolean;
  readonly canAdvance: boolean;
  readonly isComplete: boolean;
  readonly response: "ready" | "submitting" | "not-resumable";
}

export interface ComposerPrimaryActionInput {
  readonly pendingAction: ComposerPendingAnswer | null;
  readonly canOperateThread: boolean;
  readonly canQueueMessage: boolean;
  readonly canInterrupt: boolean;
  readonly canResume: boolean;
  readonly isRunning: boolean;
  readonly followUpBehavior: "queue" | "steer";
  readonly canSteer: boolean;
  readonly alternateModifier: boolean;
  readonly isEditingQueuedMessage: boolean;
  readonly hasSendableContent: boolean;
  readonly isSendBusy: boolean;
  readonly isPreparingWorktree: boolean;
  readonly sendDisabledReason: string | null;
  readonly isEnvironmentUnavailable: boolean;
  /** Whether a provider can take a message: `pending` until the provider catalog is known. */
  readonly providerQueue: "ready" | "pending" | "unavailable";
  readonly isProjectSelectionRequired: boolean;
}

export type ComposerPrimaryActionBlock =
  | {
      readonly reason:
        | "environment-disconnected"
        | "project-required"
        | "provider-unavailable"
        | "provider-pending"
        | "question-not-answerable"
        | "not-permitted"
        | "answer-incomplete"
        | "nothing-to-send";
    }
  | { readonly reason: "send-disabled"; readonly message: string };

type ComposerSubmitKind = "resume" | "update-queued" | "queue" | "steer" | "send";

/** The control is disabled while `busy` or `blocked`. */
export type ComposerPrimaryAction = {
  readonly busy: boolean;
  readonly blocked: ComposerPrimaryActionBlock | null;
} & (
  | { readonly kind: "answer"; readonly questionIndex: number; readonly isLastQuestion: boolean }
  | { readonly kind: "stop" }
  | { readonly kind: ComposerSubmitKind; readonly preparingWorktree: boolean }
);

// A disconnected environment still queues messages, so it only blocks actions that need it now.
function availabilityBlock(
  input: ComposerPrimaryActionInput,
  needsEnvironment: boolean,
): ComposerPrimaryActionBlock | null {
  const providerBlocked = input.providerQueue !== "ready";
  if (
    input.isEnvironmentUnavailable &&
    (needsEnvironment || providerBlocked || input.isProjectSelectionRequired)
  ) {
    return { reason: "environment-disconnected" };
  }
  if (input.isProjectSelectionRequired) return { reason: "project-required" };
  if (!providerBlocked) return null;
  return {
    reason: input.providerQueue === "pending" ? "provider-pending" : "provider-unavailable",
  };
}

function answerBlock(
  input: ComposerPrimaryActionInput,
  pendingAction: ComposerPendingAnswer,
): ComposerPrimaryActionBlock | null {
  if (pendingAction.response === "not-resumable") return { reason: "question-not-answerable" };
  const unavailable = availabilityBlock(input, true);
  if (unavailable) return unavailable;
  if (!input.canOperateThread) return { reason: "not-permitted" };
  const answered = pendingAction.isLastQuestion
    ? pendingAction.isComplete
    : pendingAction.canAdvance;
  return answered ? null : { reason: "answer-incomplete" };
}

function submitKind(input: ComposerPrimaryActionInput): ComposerSubmitKind {
  if (input.isEditingQueuedMessage) return "update-queued";
  if (input.canResume && !input.hasSendableContent) return "resume";
  if (!input.isRunning) return "send";
  const mode = resolveComposerDispatchMode({
    running: true,
    activeTurnDefault: input.followUpBehavior,
    canSteer: input.canSteer,
    alternateModifier: input.alternateModifier,
  });
  return mode === "queue" ? "queue" : "steer";
}

function submitBlock(
  input: ComposerPrimaryActionInput,
  kind: ComposerSubmitKind,
): ComposerPrimaryActionBlock | null {
  const resumes = kind === "resume";
  const unavailable = availabilityBlock(input, resumes);
  if (unavailable) return unavailable;
  if (input.sendDisabledReason !== null) {
    return { reason: "send-disabled", message: input.sendDisabledReason };
  }
  if (!(resumes ? input.canOperateThread : input.canQueueMessage)) {
    return { reason: "not-permitted" };
  }
  return resumes || input.hasSendableContent ? null : { reason: "nothing-to-send" };
}

export function resolveComposerPrimaryAction(
  input: ComposerPrimaryActionInput,
): ComposerPrimaryAction {
  const { pendingAction } = input;
  if (pendingAction) {
    return {
      kind: "answer",
      questionIndex: pendingAction.questionIndex,
      isLastQuestion: pendingAction.isLastQuestion,
      busy: pendingAction.response === "submitting",
      blocked: answerBlock(input, pendingAction),
    };
  }
  if (input.canInterrupt && !input.hasSendableContent && !input.isEditingQueuedMessage) {
    return {
      kind: "stop",
      busy: false,
      blocked: input.canOperateThread ? null : { reason: "not-permitted" },
    };
  }
  const kind = submitKind(input);
  return {
    kind,
    busy: input.isSendBusy,
    preparingWorktree: input.isPreparingWorktree,
    blocked: submitBlock(input, kind),
  };
}
