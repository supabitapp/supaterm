import type { EnvironmentId, ThreadId, WorktreeSetupSnapshot } from "@supaterm/contracts";
import { resolveVisibleWorktreeSetup } from "@supaterm/client-runtime/worktree-setup";
import { useEffect, useState } from "react";
import { useEnvironmentQuery } from "../../state/query";
import { vcsEnvironment } from "../../state/vcs";
import { WORKTREE_SETUP_EXIT_MS, type WorktreeSetupCardProps } from "./worktree-setup-card";
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
  const { exiting, generation } = next;
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- drops the exiting card once its UI-thread collapse has run, even if its row was recycled; a returning setup clears the timer
  useEffect(() => {
    if (!exiting) return;
    const timeout = setTimeout(
      () => setPresence((latest) => finishWorktreeSetupExit(latest, generation)),
      WORKTREE_SETUP_EXIT_MS,
    );
    return () => clearTimeout(timeout);
  }, [exiting, generation]);
  const card = setup ?? next.setup;
  return card ? { card, exiting, generation } : null;
}
