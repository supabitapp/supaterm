import type { ThreadId, WorktreeSetupSnapshot } from "@supaterm/contracts";
import type { WorktreeSetupCardProps } from "./worktree-setup-card";

/** A subscription can close or replay an older value during the setup handoff. */
export function resolveWorktreeSetupSnapshot(
  threadId: ThreadId | null,
  latest: WorktreeSetupSnapshot | null | undefined,
  held: WorktreeSetupSnapshot | null,
): WorktreeSetupSnapshot | null {
  const current = latest?.threadId === threadId ? latest : null;
  const previous = held?.threadId === threadId ? held : null;
  return current && (!previous || current.sequence >= previous.sequence) ? current : previous;
}

export interface WorktreeSetupPresence {
  readonly setup: WorktreeSetupCardProps | null;
  readonly exiting: boolean;
  readonly generation: number;
}

/**
 * A setup that leaves the feed stays, marked exiting, for its collapse. Ending an
 * exit starts a new generation, so the next card never reuses a collapsed one.
 */
export function nextWorktreeSetupPresence(
  previous: WorktreeSetupPresence,
  current: WorktreeSetupCardProps | null,
): WorktreeSetupPresence {
  if (current === null) {
    return previous.setup === null || previous.exiting ? previous : { ...previous, exiting: true };
  }
  if (previous.exiting) {
    return { setup: current, exiting: false, generation: previous.generation + 1 };
  }
  return previous.setup?.snapshot === current.snapshot &&
    previous.setup.turnStarted === current.turnStarted
    ? previous
    : { ...previous, setup: current };
}

export function finishWorktreeSetupExit(
  presence: WorktreeSetupPresence,
  generation: number,
): WorktreeSetupPresence {
  return presence.exiting && presence.generation === generation
    ? { setup: null, exiting: false, generation: generation + 1 }
    : presence;
}
