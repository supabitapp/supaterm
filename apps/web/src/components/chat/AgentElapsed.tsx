import type { RuntimeSubagent } from "@supaterm/client-runtime/state/subagentRuntime";
import { isOrchestrationV2WorkActive } from "@supaterm/contracts";
import { deriveSubagentElapsedMs } from "@supaterm/shared/orchestrationTiming";
import { tickTextContent } from "~/lib/tickTextContent";

function formatElapsedSeconds(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  if (minutes === 0) {
    return `${seconds}s`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours === 0) {
    return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  }
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/**
 * Elapsed time for the current activation. Live agents self-tick via DOM
 * writes (zero React commits per tick); settled agents freeze at completedAt.
 */
export function AgentElapsed({
  agent,
}: {
  agent: Pick<RuntimeSubagent, "status" | "startedAt" | "completedAt">;
}) {
  const live = isOrchestrationV2WorkActive(agent.status);
  const { status, startedAt, completedAt } = agent;
  if (deriveSubagentElapsedMs(agent, 0) === null) {
    return null;
  }
  return (
    <span
      ref={tickTextContent((nowMs) => {
        const elapsedMs = deriveSubagentElapsedMs({ status, startedAt, completedAt }, nowMs);
        return elapsedMs === null ? "" : formatElapsedSeconds(elapsedMs / 1000);
      }, live)}
      className="tabular-nums"
    />
  );
}
