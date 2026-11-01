import { CommandId, MessageId, type ThreadWorkflowRunWatch } from "@supaterm/contracts";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import type * as Scope from "effect/Scope";

import * as PullRequestService from "../pullRequest/PullRequestService.ts";
import { forkParked } from "../serverActivation.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import { workflowRunWatchMessage, workflowRunWatchStoppedMessage } from "./workflowRunWatch.ts";

/** Seconds between passes. A run takes minutes; a pass costs two reads per watched run. */
const SWEEP_SECONDS = 60;
/** Reads in a row that failed for a reason other than a rate limit before the watch ends. */
const READ_FAILURE_LIMIT = 8;
/**
 * How long a watch lasts, GitHub's own default job timeout. A run waiting on an approval can
 * stay pending for days, and would hold its thread in Working the whole time.
 */
const MAX_WATCH_MS = 6 * 60 * 60_000;

type WatchTarget = {
  readonly thread: ProjectionStore.ProjectionThreadWorkflowRunWatches;
  readonly watch: ThreadWorkflowRunWatch;
};

const targetKey = ({ thread, watch }: WatchTarget) =>
  `${thread.id} ${watch.host}/${watch.repository}#${watch.runId} ${watch.startedAt}`;

const logFailure =
  (message: string, fields: Record<string, unknown>) =>
  <E>(cause: Cause.Cause<E>): Effect.Effect<void> =>
    Cause.hasInterruptsOnly(cause)
      ? Effect.interrupt
      : Effect.logWarning(message, { ...fields, cause });

/**
 * Watches GitHub Actions runs for the agents that asked (`watch_workflow_run`), and wakes each
 * agent once, when its run completes, with every job that did not pass. Settling, archiving or
 * stopping the thread ends its watches, and so do reads that keep failing.
 */
export class WorkflowRunWatchReactor extends Context.Service<
  WorkflowRunWatchReactor,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    /** One pass over every watched run. */
    readonly sweep: Effect.Effect<void>;
  }
>()("supaterm/orchestration-v2/WorkflowRunWatchReactor") {}

/** @public */
export const make = Effect.gen(function* () {
  const engine = yield* Orchestrator.OrchestratorV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const pullRequests = yield* PullRequestService.PullRequestService;
  const crypto = yield* Crypto.Crypto;
  // Reads in a row that failed, per watch. Kept in memory: a restart only delays the stop.
  const readFailures = new Map<string, number>();

  /**
   * Ends the watch, waking the agent when `wake` is set. The orchestrator applies this only
   * while the same watch is on, so a stop that lands during the read wins.
   */
  const end = Effect.fn("WorkflowRunWatchReactor.end")(function* (
    { thread, watch }: WatchTarget,
    reason: string,
    wake?: ReturnType<typeof workflowRunWatchMessage>,
  ) {
    const uuid = yield* crypto.randomUUIDv4();
    yield* engine.dispatch({
      type: "thread.workflow-run-watch.end",
      commandId: CommandId.make(`server:run-watch:${thread.id}:${uuid}`),
      threadId: thread.id,
      host: watch.host,
      repository: watch.repository,
      runId: watch.runId,
      startedAt: watch.startedAt,
      ...(wake === undefined
        ? {}
        : { wake: { ...wake, messageId: MessageId.make(`message:run-watch:${uuid}`) } }),
    });
    const now = yield* Clock.currentTimeMillis;
    yield* Effect.logInfo("workflow run watch ended", {
      threadId: thread.id,
      run: `${watch.host}/${watch.repository}#${watch.runId}`,
      reason,
      minutes: Math.round((now - Date.parse(watch.startedAt)) / 60_000),
    });
  });

  const check = Effect.fn("WorkflowRunWatchReactor.check")(function* (target: WatchTarget) {
    const { thread, watch } = target;
    const key = targetKey(target);
    const read = yield* Effect.exit(
      pullRequests.workflowRun({
        projectId: thread.projectId,
        host: watch.host,
        repository: watch.repository,
        runId: watch.runId,
      }),
    );
    if (Exit.isFailure(read)) {
      if (Cause.hasInterruptsOnly(read.cause)) return yield* Effect.failCause(read.cause);
      // The host's pause refuses later reads without a request, so waiting it out is free.
      if (PullRequestService.isRateLimited(read.cause)) return;
      const failures = (readFailures.get(key) ?? 0) + 1;
      readFailures.set(key, failures);
      if (failures >= READ_FAILURE_LIMIT) {
        yield* end(
          target,
          "unreadable",
          workflowRunWatchStoppedMessage(
            watch,
            `it failed to read it ${READ_FAILURE_LIMIT} times in a row`,
          ),
        ).pipe(Effect.catch(() => end(target, "unreadable")));
        readFailures.delete(key);
      }
      return yield* Effect.failCause(read.cause);
    }
    readFailures.delete(key);
    const run = read.value;
    if (run === null) {
      return yield* end(
        target,
        "unsupported",
        workflowRunWatchStoppedMessage(watch, "this project's host has no runs it can read"),
      );
    }
    if (run.status !== "pending") {
      return yield* end(target, "completed", workflowRunWatchMessage(watch, run));
    }
    const now = yield* Clock.currentTimeMillis;
    if (now - Date.parse(watch.startedAt) >= MAX_WATCH_MS) {
      yield* end(
        target,
        "expired",
        workflowRunWatchStoppedMessage(watch, "it was still running after 6 hours"),
      );
    }
  });

  const sweep = Effect.gen(function* () {
    const threads = yield* projections.getThreadsWithWorkflowRunWatches();
    const targets = threads.flatMap((thread) =>
      thread.workflowRunWatches.map((watch) => ({ thread, watch })),
    );
    const present = new Set(targets.map(targetKey));
    for (const key of readFailures.keys()) if (!present.has(key)) readFailures.delete(key);
    yield* Effect.forEach(
      targets,
      (target) =>
        check(target).pipe(
          Effect.catchCause(
            logFailure("workflow run watch check failed", {
              threadId: target.thread.id,
              runId: target.watch.runId,
            }),
          ),
        ),
      { concurrency: 4, discard: true },
    );
  }).pipe(
    Effect.catchCause(logFailure("workflow run watch sweep failed", {})),
    Effect.withSpan("WorkflowRunWatchReactor.sweep"),
  );

  const start: WorkflowRunWatchReactor["Service"]["start"] = () =>
    forkParked(
      sweep.pipe(Effect.repeat(Schedule.spaced(`${SWEEP_SECONDS} seconds`)), Effect.asVoid),
    );

  return { start, sweep } satisfies WorkflowRunWatchReactor["Service"];
});

export const layer = Layer.effect(WorkflowRunWatchReactor, make);
