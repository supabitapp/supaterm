import { resolveThreadWorkingStartedAt, type EnvironmentThreadShell } from "./models.ts";

export function formatWorkingDurationLabel(elapsedMs: number): string {
  const seconds = Number.isFinite(elapsedMs) ? Math.max(0, Math.floor(elapsedMs / 1000)) : 0;
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** Working counts the whole wait for a response, across background wakes and
 * steers. Waiting counts only since the work parked on background tasks; a run
 * that never started, such as a cancelled queued message, never parked. */
export function resolveThreadListDurationStartedAt(
  thread: Pick<EnvironmentThreadShell, "latestRun" | "runtime">,
): string | null {
  if (thread.runtime?.status !== "idle") return resolveThreadWorkingStartedAt(thread);
  const run = thread.latestRun;
  if (run?.startedAt == null || run.completedAt == null) return null;
  return Number.isFinite(Date.parse(run.completedAt)) ? run.completedAt : null;
}

export function resolveThreadTotalWorkMs(
  thread: Pick<EnvironmentThreadShell, "completedWorkMs" | "latestRun" | "runtime">,
  nowMs: number,
): number | null {
  if (thread.completedWorkMs === null) return null;
  const workingStartedAt = resolveThreadWorkingStartedAt(thread);
  return workingStartedAt === null
    ? thread.completedWorkMs
    : thread.completedWorkMs + Math.max(0, nowMs - Date.parse(workingStartedAt));
}
