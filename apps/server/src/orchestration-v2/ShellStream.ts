import type {
  ApplicationStoredEvent,
  OrchestrationProjectShell,
  OrchestrationV2OlderDoneCount,
  OrchestrationV2OlderDoneThreads,
  OrchestrationV2ShellSnapshot,
  OrchestrationV2ThreadShell,
  OrchestrationV2ThreadShellSnapshot,
  OrchestrationV2ShellStreamItem,
  ProjectId,
} from "@supaterm/contracts";
import {
  isListedThreadLineage,
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
import type { ActiveShellIndexEntry } from "./ProjectionStore.ts";

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

function buildActiveShellSnapshot(input: {
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

type ShellTrimRow = Pick<
  OrchestrationV2ThreadShell,
  "id" | "projectId" | "lineage" | "doneOverride" | "doneAt"
>;

/**
 * What a subscriber's trims read across every active row. Computed from full shells or from the
 * store's index, so a snapshot read only for the rows it sends trims the same way.
 */
interface ShellTrimFacts {
  readonly subagentParentIds: ReadonlySet<string>;
  readonly subagentThreadIds: Set<string>;
  /** Undefined when no thread is done, so none is older. */
  readonly olderDoneBeforeMs: number | undefined;
  readonly olderDoneCounts: ReadonlyArray<OrchestrationV2OlderDoneCount>;
}

const NEWEST_DONE_KEPT = 25;

function shellTrimFacts(rows: ReadonlyArray<ShellTrimRow>): ShellTrimFacts {
  const subagentParentIds = new Set<string>();
  const subagentThreadIds = new Set<string>();
  const doneTimes: Array<number> = [];
  for (const row of rows) {
    if (row.lineage.relationshipToParent === "subagent") {
      subagentThreadIds.add(row.id);
      if (row.lineage.parentThreadId) subagentParentIds.add(row.lineage.parentThreadId);
    } else if (
      isListedThreadLineage(row.lineage) &&
      row.doneOverride === "done" &&
      row.doneAt !== null
    ) {
      doneTimes.push(DateTime.toEpochMillis(row.doneAt));
    }
  }
  doneTimes.sort((left, right) => right - left);
  // With fewer than 25, the oldest one is the cut, so nothing is older.
  const olderDoneBeforeMs = doneTimes[NEWEST_DONE_KEPT - 1] ?? doneTimes.at(-1);
  const counts = new Map<ProjectId, number>();
  if (olderDoneBeforeMs !== undefined) {
    for (const row of rows) {
      if (isOlderDoneThreadShell(row, olderDoneBeforeMs)) {
        counts.set(row.projectId, (counts.get(row.projectId) ?? 0) + 1);
      }
    }
  }
  return {
    subagentParentIds,
    subagentThreadIds,
    olderDoneBeforeMs,
    olderDoneCounts: Array.from(counts, ([projectId, count]) => ({ projectId, count })),
  };
}

function hiddenChildAncestorIds(
  threads: ReadonlyArray<Pick<OrchestrationV2ThreadShell, "lineage">>,
) {
  const ancestorIds = new Set<string>();
  for (const thread of threads) {
    if (isListedThreadLineage(thread.lineage)) continue;
    if (thread.lineage.parentThreadId !== null) ancestorIds.add(thread.lineage.parentThreadId);
    ancestorIds.add(thread.lineage.rootThreadId);
  }
  return ancestorIds;
}

function omitIdleSubagentShellsWith(
  threads: ReadonlyArray<OrchestrationV2ThreadShell>,
  facts: Pick<ShellTrimFacts, "subagentParentIds">,
): ReadonlyArray<OrchestrationV2ThreadShell> {
  return threads.filter(
    (thread) =>
      thread.lineage.relationshipToParent !== "subagent" ||
      isLiveSubagentShell(thread) ||
      facts.subagentParentIds.has(thread.id),
  );
}

function omitOlderDoneShellsWith(
  input: {
    readonly threads: ReadonlyArray<OrchestrationV2ThreadShell>;
    readonly snapshotSequence: number;
    readonly now: DateTime.Utc;
  },
  facts: Pick<ShellTrimFacts, "olderDoneBeforeMs" | "olderDoneCounts">,
): {
  readonly threads: ReadonlyArray<OrchestrationV2ThreadShell>;
  readonly olderDone: OrchestrationV2OlderDoneThreads;
} {
  const nowMs = DateTime.toEpochMillis(input.now);
  const beforeMs = facts.olderDoneBeforeMs ?? nowMs;
  const ancestorIds = hiddenChildAncestorIds(input.threads);
  const threads = input.threads.filter(
    (thread) =>
      !isOlderDoneThreadShell(thread, beforeMs) ||
      thread.pinnedAt != null ||
      (thread.snoozedUntil != null && DateTime.toEpochMillis(thread.snoozedUntil) > nowMs) ||
      isLiveSubagentShell(thread) ||
      ancestorIds.has(thread.id),
  );
  return {
    threads,
    olderDone: {
      before: DateTime.formatIso(DateTime.makeUnsafe(beforeMs)),
      asOfSequence: input.snapshotSequence,
      counts: facts.olderDoneCounts,
    },
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
  return omitIdleSubagentShellsWith(threads, shellTrimFacts(threads));
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
  const facts = shellTrimFacts(threads);
  return {
    threads: omitIdleSubagents ? omitIdleSubagentShellsWith(threads, facts) : threads,
    subagentThreadIds: facts.subagentThreadIds,
  };
}

/**
 * Opted-in snapshots keep the 25 newest done top-level threads (and ties) and count the rest per
 * project in `olderDone`; clients page them with `getOlderDoneThreads`. Older rows stay while
 * pinned, snoozed, live, or above a kept subagent or side chat, so walks over shell rows still find
 * them.
 */
export function omitOlderDoneShells(input: {
  readonly threads: ReadonlyArray<OrchestrationV2ThreadShell>;
  readonly snapshotSequence: number;
  readonly now: DateTime.Utc;
}): {
  readonly threads: ReadonlyArray<OrchestrationV2ThreadShell>;
  readonly olderDone: OrchestrationV2OlderDoneThreads;
} {
  return omitOlderDoneShellsWith(input, shellTrimFacts(input.threads));
}

interface ShellSubscriberOptions {
  readonly omitIdleSubagents: boolean;
  readonly omitOlderDone: boolean;
}

function trimShellSnapshot(
  base: OrchestrationV2ShellSnapshot,
  facts: ShellTrimFacts,
  options: ShellSubscriberOptions & { readonly now: DateTime.Utc },
): OrchestrationV2ShellSnapshot {
  const threads = options.omitIdleSubagents
    ? omitIdleSubagentShellsWith(base.threads, facts)
    : base.threads;
  if (!options.omitOlderDone) return { ...base, threads };
  const older = omitOlderDoneShellsWith(
    { threads, snapshotSequence: base.snapshotSequence, now: options.now },
    facts,
  );
  return { ...base, threads: older.threads, olderDone: older.olderDone };
}

/**
 * The threads whose shells a trimmed snapshot can contain: a superset of what the trims keep, so
 * trimming the shells read for these ids gives the snapshot trimming every shell would.
 */
function shellSubscriberThreadIds(
  index: ReadonlyArray<ActiveShellIndexEntry>,
  options: ShellSubscriberOptions,
): ReadonlyArray<ThreadId> {
  const facts = shellTrimFacts(index);
  const subagents = index.filter(
    (entry) =>
      entry.lineage.relationshipToParent === "subagent" &&
      (!options.omitIdleSubagents || entry.mayBeLive || facts.subagentParentIds.has(entry.id)),
  );
  const ancestorIds = hiddenChildAncestorIds([
    ...subagents,
    ...index.filter((entry) => entry.lineage.sideChat === true),
  ]);
  const keptSubagentIds = new Set(subagents.map((entry) => entry.id));
  const beforeMs = facts.olderDoneBeforeMs;
  return index.flatMap((entry) =>
    entry.lineage.relationshipToParent === "subagent"
      ? keptSubagentIds.has(entry.id)
        ? [entry.id]
        : []
      : !options.omitOlderDone ||
          beforeMs === undefined ||
          !isOlderDoneThreadShell(entry, beforeMs) ||
          entry.pinnedAt != null ||
          entry.snoozedUntil != null ||
          entry.mayBeLive ||
          ancestorIds.has(entry.id)
        ? [entry.id]
        : [],
  );
}

/**
 * A subscriber's active shell snapshot, read like `loadShellSnapshotParts`. With an opt-in, the
 * store's index decides which shells to read, so threads the trims drop are never built.
 */
export const loadSubscriberShellSnapshot = Effect.fn("ShellStream.loadSubscriberShellSnapshot")(
  function* <E1, E2, E3, E4, E5>(input: {
    readonly sql: SqlClient.SqlClient;
    readonly listShellIndex: Effect.Effect<ReadonlyArray<ActiveShellIndexEntry>, E1>;
    readonly readThreads: (
      threadIds: ReadonlyArray<ThreadId> | undefined,
    ) => Effect.Effect<Effect.Effect<OrchestrationV2ThreadShellSnapshot, E3>, E2>;
    readonly listProjects: Effect.Effect<ReadonlyArray<OrchestrationProjectShell>, E4>;
    readonly latestSequence: Effect.Effect<number, E5>;
    readonly options: ShellSubscriberOptions;
  }) {
    const trims = input.options.omitIdleSubagents || input.options.omitOlderDone;
    const read = yield* input.sql
      .withTransaction(
        Effect.gen(function* () {
          const index = trims ? yield* input.listShellIndex : null;
          return {
            index,
            decodeThreads: yield* input.readThreads(
              index === null ? undefined : shellSubscriberThreadIds(index, input.options),
            ),
            projects: yield* input.listProjects,
            snapshotSequence: yield* input.latestSequence,
          };
        }),
      )
      .pipe(NodeSqliteClient.readOnly);
    const base = buildActiveShellSnapshot({
      projects: read.projects,
      threads: yield* read.decodeThreads,
      snapshotSequence: read.snapshotSequence,
    });
    const facts = shellTrimFacts(read.index ?? base.threads);
    return {
      snapshot: trimShellSnapshot(base, facts, { ...input.options, now: yield* DateTime.now }),
      subagentThreadIds: facts.subagentThreadIds,
    };
  },
);

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
