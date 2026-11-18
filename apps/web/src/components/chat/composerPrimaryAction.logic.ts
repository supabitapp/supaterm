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
  readonly providerAvailability: "ready" | "pending" | "unavailable";
  readonly isProjectSelectionRequired: boolean;
  readonly stopPhase: ComposerStopPhase;
}

/**
 * Where a Stop the reader clicked stands: `pending` until the run stops or the wait times out,
 * then `landed` for a moment so repeat clicks cannot hit what took Stop's place.
 */
export type ComposerStopPhase = "idle" | "pending" | "timedOut" | "landed";

export interface ComposerStopState {
  readonly runId: string | null;
  readonly phase: ComposerStopPhase;
}

const COMPOSER_STOP_PENDING_MAX_MS = 10_000;
const COMPOSER_STOP_LANDED_CLICK_GUARD_MS = 500;

/** Returns `state` itself when nothing changes, so it can run on every render. */
export function stepComposerStop(
  state: ComposerStopState,
  input: {
    readonly runId: string | null;
    readonly canInterrupt: boolean;
    readonly canOperateThread: boolean;
  },
): ComposerStopState {
  if (input.runId !== null && state.runId !== input.runId) {
    return { runId: input.runId, phase: "idle" };
  }
  // Losing permission also clears canInterrupt; it does not acknowledge the stop.
  if (!input.canOperateThread) return state;
  if ((state.phase === "pending" || state.phase === "timedOut") && !input.canInterrupt) {
    return { ...state, phase: "landed" };
  }
  if (state.phase === "landed" && input.canInterrupt) return { ...state, phase: "idle" };
  return state;
}

export function requestComposerStop(state: ComposerStopState): ComposerStopState {
  return state.phase === "pending" ? state : { ...state, phase: "pending" };
}

/** The phase a timer ends: an unanswered stop can be retried, and the click guard lifts. */
export function expireComposerStop(state: ComposerStopState): ComposerStopState {
  if (state.phase === "pending") return { ...state, phase: "timedOut" };
  if (state.phase === "landed") return { ...state, phase: "idle" };
  return state;
}

export function composerStopDeadlineMs(phase: ComposerStopPhase): number | null {
  if (phase === "pending") return COMPOSER_STOP_PENDING_MAX_MS;
  if (phase === "landed") return COMPOSER_STOP_LANDED_CLICK_GUARD_MS;
  return null;
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

export type ComposerPrimaryAction = {
  readonly busy: boolean;
  readonly blocked: ComposerPrimaryActionBlock | null;
  /** The Stop control beside this action: absent, ready, or waiting on a stop already sent. */
  readonly stop: "none" | "ready" | "stopping";
  /** A stop just landed, so this action, now where Stop was, ignores clicks. */
  readonly guarded: boolean;
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
  const providerBlocked = input.providerAvailability !== "ready";
  if (
    input.isEnvironmentUnavailable &&
    (needsEnvironment || providerBlocked || input.isProjectSelectionRequired)
  ) {
    return { reason: "environment-disconnected" };
  }
  if (input.isProjectSelectionRequired) return { reason: "project-required" };
  if (!providerBlocked) return null;
  return {
    reason: input.providerAvailability === "pending" ? "provider-pending" : "provider-unavailable",
  };
}

// An answer responds to the open request rather than starting a turn, so provider and project
// state cannot block it; only its connection and its own attachments can.
function answerBlock(
  input: ComposerPrimaryActionInput,
  pendingAction: ComposerPendingAnswer,
): ComposerPrimaryActionBlock | null {
  if (pendingAction.response === "not-resumable") return { reason: "question-not-answerable" };
  if (input.isEnvironmentUnavailable) return { reason: "environment-disconnected" };
  if (input.sendDisabledReason !== null) {
    return { reason: "send-disabled", message: input.sendDisabledReason };
  }
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
  const { pendingAction, stopPhase } = input;
  const stopWaiting = stopPhase === "pending" || stopPhase === "timedOut";
  const stop =
    input.canInterrupt || stopWaiting ? (stopPhase === "pending" ? "stopping" : "ready") : "none";
  const guarded = stopPhase === "landed";
  if (pendingAction) {
    return {
      kind: "answer",
      questionIndex: pendingAction.questionIndex,
      isLastQuestion: pendingAction.isLastQuestion,
      busy: pendingAction.response === "submitting",
      blocked: answerBlock(input, pendingAction),
      stop,
      guarded,
    };
  }
  if (stop !== "none" && !input.hasSendableContent && !input.isEditingQueuedMessage) {
    return {
      kind: "stop",
      busy: false,
      blocked: input.canOperateThread ? null : { reason: "not-permitted" },
      stop,
      guarded: false,
    };
  }
  const kind = submitKind(input);
  return {
    kind,
    busy: input.isSendBusy,
    preparingWorktree: input.isPreparingWorktree,
    blocked: submitBlock(input, kind),
    stop,
    guarded,
  };
}
