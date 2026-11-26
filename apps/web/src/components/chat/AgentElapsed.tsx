import type { RuntimeSubagent } from "@supaterm/client-runtime/state/subagentRuntime";
import { isOrchestrationV2WorkActive } from "@supaterm/contracts";
import { deriveSubagentElapsedMs } from "@supaterm/shared/orchestrationTiming";
import { tickTextContent } from "~/lib/tickTextContent";
import { msg, useMessages } from "gt-react";
import type { MessageResolver } from "~/i18n/messages";

export function formatElapsedSeconds(totalSeconds: number, resolve: MessageResolver): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  if (minutes === 0) {
    return resolve(msg("{seconds}s", { seconds, $context: "elapsed time, seconds" }));
  }
  const hours = Math.floor(minutes / 60);
  if (hours === 0) {
    return resolve(
      msg("{minutes}m {seconds}s", {
        minutes,
        seconds: String(seconds % 60).padStart(2, "0"),
        $context: "elapsed time, minutes and seconds",
      }),
    );
  }
  return resolve(
    msg("{hours}h {minutes}m", {
      hours,
      minutes: String(minutes % 60).padStart(2, "0"),
      $context: "elapsed time, hours and minutes",
    }),
  );
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
  const m = useMessages();
  const live = isOrchestrationV2WorkActive(agent.status);
  const { status, startedAt, completedAt } = agent;
  if (deriveSubagentElapsedMs(agent, 0) === null) {
    return null;
  }
  return (
    <span
      ref={tickTextContent((nowMs) => {
        const elapsedMs = deriveSubagentElapsedMs({ status, startedAt, completedAt }, nowMs);
        return elapsedMs === null ? "" : formatElapsedSeconds(elapsedMs / 1000, m);
      }, live)}
      className="tabular-nums"
    />
  );
}
