import { useEffect, useState } from "react";
import { WORKTREE_SETUP_EXIT_MS, type WorktreeSetupCardProps } from "./worktree-setup-card";
import {
  finishWorktreeSetupExit,
  nextWorktreeSetupPresence,
  type WorktreeSetupPresence,
} from "./worktree-setup-state";

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
