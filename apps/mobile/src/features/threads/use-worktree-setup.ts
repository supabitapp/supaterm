import type { EnvironmentId, ThreadId, WorktreeSetupSnapshot } from "@supaterm/contracts";
import { resolveVisibleWorktreeSetup } from "@supaterm/client-runtime/worktree-setup";
import { useState } from "react";
import { useEnvironmentQuery } from "../../state/query";
import { vcsEnvironment } from "../../state/vcs";
import type { WorktreeSetupCardProps } from "./worktree-setup-card";
import {
  finishWorktreeSetupExit,
  nextWorktreeSetupPresence,
  resolveWorktreeSetupSnapshot,
  type WorktreeSetupPresence,
} from "./worktree-setup-state";

export function useWorktreeSetup(input: {
  environmentId: EnvironmentId | null;
  threadId: ThreadId | null;
  preparing: boolean;
  turnStarted: boolean;
  followUpSent: boolean;
}) {
  const key = JSON.stringify([input.environmentId, input.threadId]);
  const [held, setHeld] = useState<{ key: string; snapshot: WorktreeSetupSnapshot } | null>(null);
  const live = held?.key === key ? held.snapshot : null;
  const query = useEnvironmentQuery(
    input.environmentId &&
      input.threadId &&
      (live?.phase === "running" || (!live && input.preparing))
      ? vcsEnvironment.worktreeSetup({
          environmentId: input.environmentId,
          input: { threadId: input.threadId },
        })
      : null,
  );
  const snapshot = resolveWorktreeSetupSnapshot(input.threadId, query.data, live);
  if (snapshot && snapshot !== live) setHeld({ key, snapshot });
  return resolveVisibleWorktreeSetup({
    live: snapshot,
    recorded: null,
    turnStarted: input.turnStarted,
    followUpSent: input.followUpSent,
  });
}

export function useExitingWorktreeSetup(setup: WorktreeSetupCardProps | null) {
  const [presence, setPresence] = useState<WorktreeSetupPresence>({
    setup,
    exiting: false,
    generation: 0,
  });
  const next = nextWorktreeSetupPresence(presence, setup);
  if (next !== presence) setPresence(next);
  const card = setup ?? next.setup;
  return card
    ? {
        card,
        exiting: next.exiting,
        generation: next.generation,
        onExited: () => setPresence(finishWorktreeSetupExit),
      }
    : null;
}
