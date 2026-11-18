import type {
  ActiveTurnComposerAction,
  ComposerDispatchMode,
} from "@supaterm/client-runtime/state/composer-dispatch";

export type FollowUpBehavior = Extract<ActiveTurnComposerAction, "queue" | "steer">;

export const DEFAULT_FOLLOW_UP_BEHAVIOR: FollowUpBehavior = "steer";

/**
 * A steer travels as "auto" so a turn that ends before delivery degrades to a queued run instead
 * of bouncing to the draft. During setup a send queues, except a steer to a server with
 * `deferredSteering`, which holds only an explicit "steer" until the turn runs.
 */
export function outboxFollowUpDispatchMode(input: {
  readonly followUpAction: ComposerDispatchMode;
  readonly setupRunning: boolean;
  readonly deferredSteering: boolean;
}): Exclude<ComposerDispatchMode, "restart"> | null {
  if (input.setupRunning) {
    return input.deferredSteering && input.followUpAction === "steer" ? "steer" : "queue";
  }
  if (input.followUpAction === "auto") return null;
  return input.followUpAction === "queue" ? "queue" : "auto";
}
