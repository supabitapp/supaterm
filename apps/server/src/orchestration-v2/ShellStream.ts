import type {
  ApplicationStoredEvent,
  OrchestrationProjectShell,
  OrchestrationV2ArchivedShellStreamItem,
  OrchestrationV2OlderDoneCount,
  OrchestrationV2OlderDoneThreads,
  OrchestrationV2ShellSnapshot,
  OrchestrationV2ThreadShell,
  OrchestrationV2ThreadShellSnapshot,
  OrchestrationV2ShellStreamItem,
  OrchestrationV2StoredEvent,
  ProjectId,
} from "@supaterm/contracts";
import {
  isLiveSubagentShell,
  isOlderDoneThreadShell,
  OrchestrationProjectShell as ProjectShellSchema,
  OrchestrationV2ThreadShell as ThreadShellSchema,
  ThreadId,
} from "@supaterm/contracts";
import * as NodeSqliteClient from "@supaterm/shared/nodeSqliteClient";
import type * as Arr from "effect/Array";
import type * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import type * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";

import type { ChangedApplicationAggregate } from "../persistence/OrchestrationEventStore.ts";
import { bufferLatestLiveStream } from "./LiveStreamBudget.ts";

type ShellDelta = Extract<OrchestrationV2ShellStreamItem, { readonly sequence: number }>;

/** Snapshots, synchronization, and enrichment markers must bypass full-state coalescing. */
export const bufferShellLiveStream = <E, R>(
  source: Stream.Stream<ShellDelta, E, R>,
  limits?: { readonly maxItems?: number; readonly maxSerializedBytes?: number },
) =>
  bufferLatestLiveStream(
    source,
    (item) => {
      switch (item.kind) {
        case "project.updated":
          return `project:${item.project.id}`;
        case "project.removed":
          return `project:${item.projectId}`;
        case "thread.updated":
          return `thread:${item.location}:${item.thread.id}`;
        case "thread.removed":
          return `thread:${item.location}:${item.threadId}`;
      }
    },
    limits,
  );

export function buildActiveShellSnapshot(input: {
  readonly projects: ReadonlyArray<OrchestrationProjectShell>;
  readonly threads: OrchestrationV2ThreadShellSnapshot;
  readonly snapshotSequence: number;
}): OrchestrationV2ShellSnapshot {
  return {
    schemaVersion: input.threads.schemaVersion,
    snapshotSequence: input.snapshotSequence,
    projects: input.projects,
    threads: input.threads.threads,
    archivedThreads: [],
  };
}

/**
 * Idle subagent children have no sidebar row, so clients that opt in read them from their thread
 * family instead. A child stays while it is live or the parent of another child, so the request
 * and working walks over shell rows never meet a gap in a nested chain.
 */
export function omitIdleSubagentShells(
  threads: ReadonlyArray<OrchestrationV2ThreadShell>,
): ReadonlyArray<OrchestrationV2ThreadShell> {
  const parentIds = new Set<string>();
  for (const thread of threads) {
    if (thread.lineage.relationshipToParent === "subagent" && thread.lineage.parentThreadId) {
      parentIds.add(thread.lineage.parentThreadId);
    }
  }
  return threads.filter(
    (thread) =>
      thread.lineage.relationshipToParent !== "subagent" ||
      isLiveSubagentShell(thread) ||
      parentIds.has(thread.id),
  );
}

/**
 * The active rows a shell subscriber gets, and the subagent ids whose transcript events its stream
 * drops. The ids come from every row, so an omitted child that wakes keeps that filter.
 */
export function activeShellRowsForSubscriber(
  threads: ReadonlyArray<OrchestrationV2ThreadShell>,
  omitIdleSubagents: boolean,
): {
  readonly threads: ReadonlyArray<OrchestrationV2ThreadShell>;
  readonly subagentThreadIds: Set<string>;
} {
  return {
    threads: omitIdleSubagents ? omitIdleSubagentShells(threads) : threads,
    subagentThreadIds: new Set(
      threads.flatMap((thread) =>
        thread.lineage.relationshipToParent === "subagent" ? [thread.id] : [],
      ),
    ),
  };
}

const NEWEST_DONE_KEPT = 25;

/**
 * Opted-in snapshots keep the 25 newest done top-level threads (and ties) and count the rest per
 * project in `olderDone`; clients page them with `getOlderDoneThreads`. Older rows stay while
 * pinned, snoozed, live, or above a kept subagent, so walks over shell rows still find them.
 */
export function omitOlderDoneShells(input: {
  readonly threads: ReadonlyArray<OrchestrationV2ThreadShell>;
  readonly snapshotSequence: number;
  readonly now: DateTime.Utc;
}): {
  readonly threads: ReadonlyArray<OrchestrationV2ThreadShell>;
  readonly olderDone: OrchestrationV2OlderDoneThreads;
} {
  const nowMs = DateTime.toEpochMillis(input.now);
  const doneTimes = input.threads
    .flatMap((thread) =>
      thread.lineage.relationshipToParent !== "subagent" &&
      thread.doneOverride === "done" &&
      thread.doneAt !== null
        ? [DateTime.toEpochMillis(thread.doneAt)]
        : [],
    )
    .sort((left, right) => right - left);
  // With fewer than 25, the oldest one is the cut, so nothing is older.
  const beforeMs = doneTimes[NEWEST_DONE_KEPT - 1] ?? doneTimes.at(-1) ?? nowMs;
  const ancestorIds = new Set<string>();
  for (const thread of input.threads) {
    if (thread.lineage.relationshipToParent !== "subagent") continue;
    if (thread.lineage.parentThreadId !== null) ancestorIds.add(thread.lineage.parentThreadId);
    ancestorIds.add(thread.lineage.rootThreadId);
  }
  const counts = new Map<ProjectId, number>();
  const threads = input.threads.filter((thread) => {
    if (!isOlderDoneThreadShell(thread, beforeMs)) return true;
    counts.set(thread.projectId, (counts.get(thread.projectId) ?? 0) + 1);
    return (
      thread.pinnedAt != null ||
      (thread.snoozedUntil != null && DateTime.toEpochMillis(thread.snoozedUntil) > nowMs) ||
      isLiveSubagentShell(thread) ||
      ancestorIds.has(thread.id)
    );
  });
  return {
    threads,
    olderDone: {
      before: DateTime.formatIso(DateTime.makeUnsafe(beforeMs)),
      asOfSequence: input.snapshotSequence,
      counts: Array.from(counts, ([projectId, count]) => ({ projectId, count })),
    },
  };
}

/**
 * The snapshot a shell subscriber gets for its opt-ins, and the subagent ids whose transcript
 * events its stream drops (from every row, so an omitted child that wakes keeps that filter).
 */
export function shellSnapshotForSubscriber(
  base: OrchestrationV2ShellSnapshot,
  options: {
    readonly omitIdleSubagents: boolean;
    readonly omitOlderDone: boolean;
    readonly now: DateTime.Utc;
  },
): {
  readonly snapshot: OrchestrationV2ShellSnapshot;
  readonly subagentThreadIds: Set<string>;
} {
  const rows = activeShellRowsForSubscriber(base.threads, options.omitIdleSubagents);
  if (!options.omitOlderDone) {
    return {
      snapshot: { ...base, threads: rows.threads },
      subagentThreadIds: rows.subagentThreadIds,
    };
  }
  const older = omitOlderDoneShells({
    threads: rows.threads,
    snapshotSequence: base.snapshotSequence,
    now: options.now,
  });
  return {
    snapshot: { ...base, threads: older.threads, olderDone: older.olderDone },
    subagentThreadIds: rows.subagentThreadIds,
  };
}

export const loadShellSnapshotParts = Effect.fn("ShellStream.loadShellSnapshotParts")(function* <
  E1,
  E2,
  E3,
  E4,
>(input: {
  readonly sql: SqlClient.SqlClient;
  readonly readThreads: Effect.Effect<Effect.Effect<OrchestrationV2ThreadShellSnapshot, E2>, E1>;
  readonly listProjects: Effect.Effect<ReadonlyArray<OrchestrationProjectShell>, E3>;
  readonly latestSequence: Effect.Effect<number, E4>;
}) {
  const read = yield* input.sql
    .withTransaction(
      Effect.all({
        decodeThreads: input.readThreads,
        projects: input.listProjects,
        snapshotSequence: input.latestSequence,
      }),
    )
    .pipe(NodeSqliteClient.readOnly);
  return {
    projects: read.projects,
    threads: yield* read.decodeThreads,
    snapshotSequence: read.snapshotSequence,
  };
});

// Resume refetches one row per changed project or thread; past this many a
// single snapshot read is cheaper.
const SHELL_RESUME_MAX_CHANGED_AGGREGATES = 500;
// Finding the changed aggregates scans the gap; past this many sequences the
// result would almost surely exceed the cap, so skip straight to a snapshot.
const SHELL_RESUME_MAX_SCANNED_SEQUENCES = 1_000_000;

/** What a client at `afterSequence` missed, or none when a snapshot should replace its shell. */
export const readShellResumeChanges = Effect.fn("ShellStream.readShellResumeChanges")(function* <
  E,
>(input: {
  readonly afterSequence: number;
  readonly highWater: number;
  readonly readChanged: (range: {
    readonly afterSequence: number;
    readonly throughSequence: number;
    readonly limit: number;
  }) => Effect.Effect<ReadonlyArray<ChangedApplicationAggregate>, E>;
}) {
  const gap = input.highWater - input.afterSequence;
  // A cursor ahead of this database's head came from another database.
  if (gap < 0 || gap > SHELL_RESUME_MAX_SCANNED_SEQUENCES) return Option.none();
  const changed = yield* input.readChanged({
    afterSequence: input.afterSequence,
    throughSequence: input.highWater,
    limit: SHELL_RESUME_MAX_CHANGED_AGGREGATES + 1,
  });
  return changed.length > SHELL_RESUME_MAX_CHANGED_AGGREGATES
    ? Option.none()
    : Option.some(changed);
});

/** A page of older done threads, read and decoded like `loadShellSnapshotParts`. */
export const loadOlderDoneThreadsPage = Effect.fn("ShellStream.loadOlderDoneThreadsPage")(
  function* <E1, E2, E3, E4>(input: {
    readonly sql: SqlClient.SqlClient;
    readonly listThreads: Effect.Effect<
      {
        readonly threadIds: ReadonlyArray<ThreadId>;
        readonly counts: ReadonlyArray<OrchestrationV2OlderDoneCount>;
      },
      E1
    >;
    readonly readThreads: (
      threadIds: ReadonlyArray<ThreadId>,
    ) => Effect.Effect<Effect.Effect<OrchestrationV2ThreadShellSnapshot, E3>, E2>;
    readonly latestSequence: Effect.Effect<number, E4>;
  }) {
    const read = yield* input.sql
      .withTransaction(
        Effect.gen(function* () {
          const listed = yield* input.listThreads;
          return {
            listed,
            decodeThreads:
              listed.threadIds.length === 0 ? null : yield* input.readThreads(listed.threadIds),
            snapshotSequence: yield* input.latestSequence,
          };
        }),
      )
      .pipe(NodeSqliteClient.readOnly);
    const threads = read.decodeThreads === null ? [] : (yield* read.decodeThreads).threads;
    const order = new Map(read.listed.threadIds.map((threadId, index) => [threadId, index]));
    return {
      snapshotSequence: read.snapshotSequence,
      threads: threads.toSorted((left, right) => order.get(left.id)! - order.get(right.id)!),
      counts: read.listed.counts,
    };
  },
);

/** Focused subagents receive these updates through their thread subscription. */
export function shouldPublishShellApplicationEvent(
  stored: ApplicationStoredEvent,
  subagentThreadIds: Set<string>,
): boolean {
  if ("aggregateKind" in stored) return true;
  const { event } = stored;
  if (event.type === "thread.created") {
    if (event.payload.lineage.relationshipToParent === "subagent") {
      subagentThreadIds.add(event.threadId);
    }
    return true;
  }
  if (event.type === "thread.deleted") {
    // Replay and the live tail overlap; keep known IDs so late events stay filtered.
    return true;
  }
  return !(
    subagentThreadIds.has(event.threadId) &&
    (event.type === "node.updated" ||
      event.type === "turn-item.updated" ||
      event.type === "provider-turn.updated" ||
      event.type === "message.updated")
  );
}

/** Shell updates refetch the aggregate, so keep only which one changed and when. */
export function toShellApplicationEvent(
  stored: ApplicationStoredEvent,
): ChangedApplicationAggregate {
  return "aggregateKind" in stored
    ? { aggregateKind: "project", aggregateId: stored.aggregateId, sequence: stored.sequence }
    : { aggregateKind: "thread", aggregateId: stored.event.threadId, sequence: stored.sequence };
}

export function coalesceShellApplicationEvents(
  events: ReadonlyArray<ChangedApplicationAggregate>,
): ReadonlyArray<ChangedApplicationAggregate> {
  const latestByAggregate = new Map<string, ChangedApplicationAggregate>();
  for (const stored of events) {
    latestByAggregate.set(`${stored.aggregateKind}:${stored.aggregateId}`, stored);
  }
  return Array.from(latestByAggregate.values()).sort(
    (left, right) => left.sequence - right.sequence,
  );
}

/** Emit the authoritative initial snapshot before marked enrichment. */
export function composeShellStreamWithEnrichment<A, E, R, A2, E2, R2, A3, E3, R3>(input: {
  readonly initial: Stream.Stream<A, E, R>;
  readonly tail: Stream.Stream<A2, E2, R2>;
  readonly enrichment: Stream.Stream<A3, E3, R3>;
}): Stream.Stream<A | A2 | A3, E | E2 | E3, R | R2 | R3> {
  const merged = Stream.fromPull(
    Effect.gen(function* () {
      const output = yield* Queue.bounded<
        {
          readonly items: Arr.NonEmptyReadonlyArray<A2 | A3>;
          readonly acknowledged?: Deferred.Deferred<void>;
        },
        E2 | E3 | Cause.Done
      >(0);
      yield* Effect.addFinalizer(() => Queue.shutdown(output));
      let remaining = 2;
      const drain = (effect: Effect.Effect<void, E2 | E3, R2 | R3>) =>
        effect.pipe(
          Effect.exit,
          Effect.flatMap((exit) =>
            Exit.isFailure(exit)
              ? Queue.failCause(output, exit.cause)
              : --remaining === 0
                ? Queue.end(output)
                : Effect.void,
          ),
          Effect.forkScoped,
        );
      yield* drain(
        input.tail.pipe(
          Stream.runForEachArray((items) =>
            Effect.gen(function* () {
              const acknowledged = yield* Deferred.make<void>();
              yield* Queue.offer(output, { items, acknowledged });
              yield* Deferred.await(acknowledged);
            }),
          ),
        ),
      );
      // Keep draining the sliding enrichment subscription after each handoff,
      // as Stream.merge does, while only the budgeted tail waits for an ACK.
      yield* drain(
        input.enrichment.pipe(Stream.runForEachArray((items) => Queue.offer(output, { items }))),
      );
      let previous: Deferred.Deferred<void> | undefined;
      // Stream.merge pulls ahead after handing off each batch. Wait for the next
      // downstream pull so shell delivery keeps that batch charged until its RPC ACK.
      // @effect-diagnostics-next-line returnEffectInGen:off - Stream.fromPull needs the pull effect as its result.
      return Effect.gen(function* () {
        if (previous) yield* Deferred.succeed(previous, undefined);
        const next = yield* Queue.take(output);
        previous = next.acknowledged;
        return next.items;
      });
    }),
  ).pipe(Stream.scoped);
  return Stream.concat(input.initial, merged);
}

const sameProjects = Schema.toEquivalence(Schema.Array(ProjectShellSchema));

export function dedupeShellEnrichment<E, R>(
  stream: Stream.Stream<OrchestrationV2ShellStreamItem, E, R>,
): Stream.Stream<OrchestrationV2ShellStreamItem, E, R> {
  return Stream.suspend(() => {
    let previous:
      | {
          readonly projects: ReadonlyArray<OrchestrationProjectShell>;
          readonly roots: ReadonlySet<string>;
        }
      | undefined;
    return stream.pipe(
      Stream.filter((item) => {
        if (item.kind !== "snapshot") {
          if (item.kind === "project.updated" || item.kind === "project.removed")
            previous = undefined;
          return true;
        }
        if (
          item.resolvedRepositoryIdentityRoots === undefined ||
          item.snapshot.threads.length > 0 ||
          item.snapshot.archivedThreads.length > 0
        ) {
          previous = undefined;
          return true;
        }
        const roots = new Set(item.resolvedRepositoryIdentityRoots);
        const prior = previous;
        if (
          prior !== undefined &&
          roots.size === prior.roots.size &&
          [...roots].every((root) => prior.roots.has(root)) &&
          sameProjects(prior.projects, item.snapshot.projects)
        )
          return false;
        previous = { projects: item.snapshot.projects, roots };
        return true;
      }),
    );
  });
}

export function shellStreamItemFromEnrichmentRefresh(input: {
  readonly snapshot: OrchestrationV2ShellSnapshot;
  readonly changes: ReadonlyArray<{ readonly workspaceRoot: string }>;
}): Extract<OrchestrationV2ShellStreamItem, { readonly kind: "snapshot" }> {
  const resolvedRepositoryIdentityRoots = [
    ...new Set(input.changes.map((change) => change.workspaceRoot)),
  ];
  return {
    kind: "snapshot",
    snapshot: {
      ...input.snapshot,
      projects: input.snapshot.projects.filter((project) =>
        resolvedRepositoryIdentityRoots.includes(project.workspaceRoot),
      ),
      threads: [],
      archivedThreads: [],
    },
    resolvedRepositoryIdentityRoots,
  };
}

export function shellStreamItemsFromInitialSnapshot(input: {
  readonly snapshot: OrchestrationV2ShellSnapshot;
  readonly resolvedRepositoryIdentityRoots: ReadonlyArray<string>;
}): ReadonlyArray<Extract<OrchestrationV2ShellStreamItem, { readonly kind: "snapshot" }>> {
  const authoritative = {
    kind: "snapshot" as const,
    snapshot: input.snapshot,
  };
  if (input.resolvedRepositoryIdentityRoots.length === 0) {
    return [authoritative];
  }
  return [
    authoritative,
    {
      kind: "snapshot" as const,
      snapshot: {
        ...input.snapshot,
        projects: input.snapshot.projects.filter((project) =>
          input.resolvedRepositoryIdentityRoots.includes(project.workspaceRoot),
        ),
        threads: [],
        archivedThreads: [],
      },
      resolvedRepositoryIdentityRoots: [...new Set(input.resolvedRepositoryIdentityRoots)],
    },
  ];
}

export function shellStreamItemsFromResumeSnapshot(input: {
  readonly snapshot: OrchestrationV2ShellSnapshot;
  readonly resolvedRepositoryIdentityRoots: ReadonlyArray<string>;
}): ReadonlyArray<Extract<OrchestrationV2ShellStreamItem, { readonly kind: "snapshot" }>> {
  return shellStreamItemsFromInitialSnapshot(input).filter(
    (item) => item.resolvedRepositoryIdentityRoots !== undefined,
  );
}

const sameThreadShell = Schema.toEquivalence(ThreadShellSchema);

const UNCHANGED_THREAD_SHELL_RESEND_MS = 5_000;

/** Resend unchanged shells after UNCHANGED_THREAD_SHELL_RESEND_MS so skipped deltas cannot leave resume cursors behind. */
export function skipUnchangedThreadShells<A extends OrchestrationV2ShellStreamItem, E, R>(
  stream: Stream.Stream<A, E, R>,
): Stream.Stream<A, E, R> {
  return Stream.suspend(() => {
    const lastSent = new Map<
      OrchestrationV2ThreadShell["id"],
      { readonly thread: OrchestrationV2ThreadShell; readonly sentAt: number }
    >();
    return stream.pipe(
      Stream.filterEffect((item) =>
        Effect.map(Clock.currentTimeMillis, (now) => {
          if (item.kind === "thread.removed") {
            lastSent.delete(item.threadId);
            return true;
          }
          if (item.kind !== "thread.updated") return true;
          const previous = lastSent.get(item.thread.id);
          if (
            previous !== undefined &&
            now - previous.sentAt < UNCHANGED_THREAD_SHELL_RESEND_MS &&
            sameThreadShell(
              { ...item.thread, updatedAt: previous.thread.updatedAt },
              previous.thread,
            )
          ) {
            return false;
          }
          lastSent.set(item.thread.id, { thread: item.thread, sentAt: now });
          return true;
        }),
      ),
    );
  });
}

export function coalesceStoredThreadEvents(
  events: ReadonlyArray<OrchestrationV2StoredEvent>,
): ReadonlyArray<OrchestrationV2StoredEvent> {
  const latestByThreadId = new Map<string, OrchestrationV2StoredEvent>();
  for (const stored of events) {
    latestByThreadId.set(stored.event.threadId, stored);
  }
  return Array.from(latestByThreadId.values()).sort(
    (left, right) => left.sequence - right.sequence,
  );
}

export function shellStreamItemFromThreadShell(input: {
  readonly stored: ChangedApplicationAggregate;
  readonly shell: OrchestrationV2ThreadShell | null;
}): Extract<
  OrchestrationV2ShellStreamItem,
  { readonly kind: "thread.updated" | "thread.removed" }
> {
  if (input.shell !== null) {
    if (input.shell.archivedAt !== null) {
      return {
        kind: "thread.removed",
        sequence: input.stored.sequence,
        location: "active",
        threadId: input.shell.id,
      };
    }
    return {
      kind: "thread.updated",
      sequence: input.stored.sequence,
      location: "active",
      thread: input.shell,
    };
  }

  return {
    kind: "thread.removed",
    sequence: input.stored.sequence,
    location: "active",
    threadId: ThreadId.make(input.stored.aggregateId),
  };
}

export function archivedShellStreamItemFromThreadShell(input: {
  readonly stored: OrchestrationV2StoredEvent;
  readonly shell: OrchestrationV2ThreadShell | null;
}): Exclude<OrchestrationV2ArchivedShellStreamItem, { readonly kind: "snapshot" }> | null {
  if (input.shell !== null && input.shell.archivedAt !== null) {
    return {
      kind: "thread.updated",
      sequence: input.stored.sequence,
      thread: input.shell,
    };
  }
  if (
    input.stored.event.type === "thread.unarchived" ||
    (input.stored.event.type === "thread.deleted" && input.stored.event.payload.archivedAt !== null)
  ) {
    return {
      kind: "thread.removed",
      sequence: input.stored.sequence,
      threadId: input.stored.event.threadId,
    };
  }
  return null;
}
