import {
  outboxDispatchMode,
  type ActiveTurnComposerAction,
  type ComposerDispatchMode,
} from "@supaterm/client-runtime/state/composer-dispatch";

export type FollowUpBehavior = Extract<ActiveTurnComposerAction, "queue" | "steer">;

export const DEFAULT_FOLLOW_UP_BEHAVIOR: FollowUpBehavior = "steer";

/** An idle send leaves the mode out, so the outbox starts the turn. */
export function outboxFollowUpDispatchMode(input: {
  readonly followUpAction: ComposerDispatchMode;
  readonly setupRunning: boolean;
  readonly deferredSteering: boolean;
}): ComposerDispatchMode | null {
  if (!input.setupRunning && input.followUpAction === "auto") return null;
  return outboxDispatchMode({
    dispatchMode: input.followUpAction,
    setupRunning: input.setupRunning,
    deferredSteering: input.deferredSteering,
  });
}
