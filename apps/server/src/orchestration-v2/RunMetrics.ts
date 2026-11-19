import type {
  OrchestrationV2Run,
  OrchestrationV2StoredEvent,
  RunId,
  ThreadId,
} from "@supaterm/contracts";
import * as DateTime from "effect/DateTime";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Metric from "effect/Metric";

import { normalizeModelMetricLabel } from "../observability/Attributes.ts";
import {
  metricAttributes,
  runDuration,
  runQueueWait,
  runsTotal,
} from "../observability/Metrics.ts";

const REMEMBERED_RUNS = 4096;
const OUTCOMES: ReadonlySet<OrchestrationV2Run["status"]> = new Set([
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);

export interface RunOutcome {
  readonly runId: RunId;
  readonly attributes: ReturnType<typeof metricAttributes>;
  readonly queueWait: Duration.Duration | undefined;
  readonly duration: Duration.Duration | undefined;
}

/**
 * Records each run once; a finished run's row updates again later, so recent runs are remembered.
 * Subagent runs are recognized by thread lineage, which `prepare` reads inside the write
 * transaction. `record` runs after commit under the publish lane and must stay free of I/O: a
 * read there waits for the writer connection, which the next writer holds while awaiting the lane.
 */
export const makeRunOutcomeRecorder = <E>(
  isSubagentThread: (threadId: ThreadId) => Effect.Effect<boolean, E>,
) => {
  const counted = new Set<string>();
  const prepare = Effect.fnUntraced(function* (events: ReadonlyArray<OrchestrationV2StoredEvent>) {
    const outcomes: Array<RunOutcome> = [];
    const delegatedThreads = new Map<ThreadId, boolean>();
    for (const { event } of events) {
      if (event.type !== "run.updated") continue;
      const run = event.payload;
      if (!OUTCOMES.has(run.status)) continue;
      let delegated = run.delegatedTaskId !== undefined || delegatedThreads.get(run.threadId);
      if (delegated === undefined) {
        delegated = yield* isSubagentThread(run.threadId).pipe(Effect.orElseSucceed(() => false));
        delegatedThreads.set(run.threadId, delegated);
      }
      outcomes.push({
        runId: run.id,
        attributes: metricAttributes({
          provider: run.providerInstanceId,
          modelFamily: normalizeModelMetricLabel(run.modelSelection.model),
          outcome: run.status,
          delegated,
        }),
        queueWait:
          run.startedAt === null ? undefined : DateTime.distance(run.requestedAt, run.startedAt),
        duration:
          run.startedAt === null || run.completedAt === null
            ? undefined
            : DateTime.distance(run.startedAt, run.completedAt),
      });
    }
    return outcomes;
  });
  const record = Effect.fnUntraced(function* (outcomes: ReadonlyArray<RunOutcome>) {
    for (const outcome of outcomes) {
      if (counted.has(outcome.runId)) continue;
      counted.add(outcome.runId);
      if (counted.size > REMEMBERED_RUNS) counted.delete(counted.values().next().value!);
      yield* Metric.update(Metric.withAttributes(runsTotal, outcome.attributes), 1);
      if (outcome.queueWait !== undefined) {
        yield* Metric.update(
          Metric.withAttributes(runQueueWait, outcome.attributes),
          outcome.queueWait,
        );
      }
      if (outcome.duration !== undefined) {
        yield* Metric.update(
          Metric.withAttributes(runDuration, outcome.attributes),
          outcome.duration,
        );
      }
    }
  }, Effect.uninterruptible);
  return { prepare, record };
};
