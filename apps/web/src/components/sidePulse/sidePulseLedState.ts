import {
  isListedThreadLineage,
  SIDE_PULSE_LED_STATES,
  type EnvironmentId,
  type SidePulseLedState,
} from "@supaterm/contracts";
import { scopedThreadKey } from "@supaterm/client-runtime/environment";
import {
  threadRuntimeIsActive,
  type EnvironmentThreadShell,
} from "@supaterm/client-runtime/state/models";
import { effectiveSnoozed } from "@supaterm/client-runtime/state/thread-snooze";
import { backgroundWorkHoldsCompletion } from "@supaterm/shared/orchestrationV2PendingBackgroundWork";

import {
  hasUnseenCompletion,
  hasUnseenFailure,
  resolveSidebarThreadStatus,
} from "../Sidebar.logic";

function threadLedState(thread: EnvironmentThreadShell, seen: boolean): SidePulseLedState {
  const status = resolveSidebarThreadStatus(thread);
  if (status === "approval" || status === "input") return "attention";
  if (
    threadRuntimeIsActive(thread.runtime) ||
    backgroundWorkHoldsCompletion(thread.pendingBackgroundTasks)
  ) {
    return "working";
  }
  if (seen) return "idle";
  if (status === "failed" || status === "limited") {
    return hasUnseenFailure(thread) ? "attention" : "idle";
  }
  return hasUnseenCompletion(thread) ? "done" : "idle";
}

/** The most urgent state across every open thread in a connected environment. */
export function selectSidePulseLedState(input: {
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly connectedEnvironmentIds: ReadonlyArray<EnvironmentId>;
  /** The thread on screen in a focused window, whose finished reply counts as seen. */
  readonly viewingThreadKey: string | null;
  readonly now: string;
}): SidePulseLedState {
  let rank = 0;
  for (const thread of input.threads) {
    // Subagent and side-chat threads reach the user through their parent's shell.
    if (
      !isListedThreadLineage(thread.lineage) ||
      thread.archivedAt !== null ||
      !input.connectedEnvironmentIds.includes(thread.environmentId) ||
      effectiveSnoozed(thread, { now: input.now })
    ) {
      continue;
    }
    const seen =
      thread.doneOverride === "done" ||
      scopedThreadKey({ environmentId: thread.environmentId, threadId: thread.id }) ===
        input.viewingThreadKey;
    rank = Math.max(rank, SIDE_PULSE_LED_STATES.indexOf(threadLedState(thread, seen)));
  }
  return SIDE_PULSE_LED_STATES[rank] ?? "idle";
}
