import { isOrchestrationV2RunUnsettled } from "@supaterm/contracts";
import type { EnvironmentThreadShell } from "./models.ts";
import { hasUnseenRunFailure } from "./threadSnooze.ts";

/**
 * Waiting (runtime "idle") is the agent parked on open subagents or monitors, blue like active
 * work rather than a false Done; commands left running, such as a dev server, read as ready.
 */
export type ThreadRowStatus =
  | "approval"
  | "input"
  | "working"
  | "waiting"
  | "failed"
  | "limited"
  | "ready";

type ThreadRowStatusInput = Pick<
  EnvironmentThreadShell,
  | "hasPendingApprovals"
  | "hasPendingUserInput"
  | "pendingSubagentRequest"
  | "runtime"
  | "blockedOnThreadWait"
>;

export function resolveThreadRowStatus(thread: ThreadRowStatusInput) {
  if (thread.hasPendingApprovals || thread.pendingSubagentRequest === "approval") {
    return "approval";
  }
  if (thread.hasPendingUserInput || thread.pendingSubagentRequest === "user_input") {
    return "input";
  }
  if (thread.runtime?.status === "running" && thread.blockedOnThreadWait === true) {
    return "waiting";
  }
  if (isOrchestrationV2RunUnsettled(thread.runtime?.status)) {
    return "working";
  }
  if (thread.runtime?.status === "idle") {
    return "waiting";
  }
  if (thread.runtime?.status === "failed") {
    return thread.runtime.lastErrorClass === "usage_limit" ? "limited" : "failed";
  }
  return "ready";
}

/** The status a row shows: a failure the user has already opened settles to ready, like Done. */
export function resolveThreadRowShownStatus(
  thread: ThreadRowStatusInput &
    Pick<EnvironmentThreadShell, "latestRun"> & {
      readonly lastVisitedAt?: string | null | undefined;
    },
) {
  const status = resolveThreadRowStatus(thread);
  if (status !== "failed" || thread.latestRun?.status !== "failed") return status;
  return hasUnseenRunFailure(thread) ? status : "ready";
}
