import * as NodeSqliteClient from "@supaterm/shared/nodeSqliteClient";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import {
  EVENT_LOG_PRUNE_MARK,
  EVENT_LOG_PRUNED_THROUGH,
} from "../persistence/OrchestrationEventStore.ts";
import * as ProjectionStore from "./ProjectionStore.ts";

export class ProjectionMaintenanceError extends Schema.TaggedError<ProjectionMaintenanceError>()(
  "ProjectionMaintenanceError",
  {
    operation: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export interface ProjectionMaintenanceV2Shape {
  readonly compactEventStore: (betweenPages?: Effect.Effect<void>) => Effect.Effect<
    {
      readonly deletedEventCount: number;
      readonly reclaimableBytes: number;
    },
    ProjectionMaintenanceError
  >;
  /** Deletes events the projections already cover once they are older than the retained history. */
  readonly pruneEventStore: <E>(options: {
    /** Runs before the first pass that deletes anything; nothing is deleted when it fails. */
    readonly backUp: Effect.Effect<unknown, E>;
    readonly betweenPages?: Effect.Effect<void>;
  }) => Effect.Effect<
    {
      readonly schedule: EventLogPruneSchedule;
      readonly deletedEventCount: number;
      readonly reclaimableBytes: number;
    },
    ProjectionMaintenanceError
  >;
  /** What pruneEventStore would delete now. Writes nothing. */
  readonly previewEventStorePrune: Effect.Effect<
    {
      readonly schedule: EventLogPruneSchedule;
      readonly prunableEventCount: number;
      readonly eventCount: number;
      readonly backupNeeded: boolean;
    },
    ProjectionMaintenanceError
  >;
}

/** Where pruning stands, read when a pass starts. */
export type EventLogPruneSchedule =
  /** No pass has marked the log: the next one marks it and deletes nothing. */
  | { readonly _tag: "Unmarked" }
  /** The mark is younger than the retained history. */
  | { readonly _tag: "Waiting"; readonly dueAt: DateTime.Utc }
  | { readonly _tag: "Due"; readonly throughSequence: number };

export class ProjectionMaintenanceV2 extends Context.Service<
  ProjectionMaintenanceV2,
  ProjectionMaintenanceV2Shape
>()("supaterm/orchestration-v2/ProjectionMaintenance/ProjectionMaintenanceV2") {}

// Reconnect replay and command-id retries read this tail; older cursors resync from a snapshot.
const RETAINED_EVENT_HISTORY = Duration.days(1);
// Small pages bound work on the reader worker and synchronous fallback.
const PAGE_SIZE = 50;
const REFERENCE_SCAN_WINDOW = 1000;

type MetadataRow = {
  readonly projection_name: string;
  readonly last_sequence: number;
  readonly updated_at: string;
};

const encodeEntityKey = Schema.encodeSync(
  Schema.fromJsonString(Schema.Tuple([Schema.String, Schema.String, Schema.NullOr(Schema.String)])),
);

export const layer: Layer.Layer<ProjectionMaintenanceV2, never, SqlClient.SqlClient> = Layer.effect(
  ProjectionMaintenanceV2,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const mapError =
      (operation: string) =>
      <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        effect.pipe(
          Effect.mapError((cause) => new ProjectionMaintenanceError({ operation, cause })),
        );

    // thread.created stays out: the replay oracle derives the expected thread set from
    // it, and it anchors replay ordering. thread.deleted stays out too: clients
    // and waitForThread switch on the event type, not just the payload.
    const SUPERSEDABLE_THREAD_EVENT_TYPES = [
      "thread.archived",
      "thread.unarchived",
      "thread.marked-done",
      "thread.reopened",
      "thread.snoozed",
      "thread.unsnoozed",
      "thread.pinned",
      "thread.auto-mark-done-set",
      "thread.unpinned",
      "thread.pin-reordered",
      "thread.active-reordered",
      "thread.metadata-updated",
      "thread.pull-request-synced",
      "thread.issue-synced",
      "thread.workflow-run-watch-synced",
      "thread.runtime-mode-updated",
      "thread.interaction-mode-updated",
      "thread.model-selection-updated",
      "thread.provider-switched",
    ];
    // Read-state and message-pin events carry the whole thread too, but client
    // reducers apply them without bumping updatedAt. They supersede only each
    // other: a newer visit must not delete the rename that carries the activity
    // timestamp, while any newer activity-bearing event supersedes both groups.
    const READ_STATE_THREAD_EVENT_TYPES = [
      "thread.visited",
      "thread.marked-unread",
      "thread.pinned-messages-updated",
    ];

    const supersedableThreadEventTypes = new Set(SUPERSEDABLE_THREAD_EVENT_TYPES);
    const readStateThreadEventTypes = new Set(READ_STATE_THREAD_EVENT_TYPES);
    // Subagent snapshots stay intact because later rows can reference an earlier prompt.
    // Commanded turn items stay for command-result replay.
    // Small pages bound work on the reader worker and synchronous fallback.
    const COMPACTION_PAGE_SIZE = 50;

    /**
     * Keyed entities keep their newest and oldest events: client reducers append an entity where
     * they first see it, so a replay from any cursor needs that first event. Page every event, as
     * filtering before LIMIT scans all history when superseded events are sparse.
     */
    const compactEventStore = Effect.fn("ProjectionMaintenance.compactEventStore")(function* (
      betweenPages: Effect.Effect<void> = Effect.void,
    ) {
      const bounds = yield* sql<{ readonly event_sequence: number }>`
        SELECT COALESCE((SELECT MAX(sequence) FROM orchestration_events), 0) AS event_sequence
      `.pipe(NodeSqliteClient.readOnly);
      let throughSequence = bounds[0]?.event_sequence ?? 0;
      const retainedThreadIds = new Set<string>();
      const retainedReadStateThreadIds = new Set<string>();
      // Per key: the lowest sequence seen so far after the newest. It is
      // deleted once an even older event turns up and kept otherwise.
      const oldestCandidateByEntityKey = new Map<string, number | null>();
      let deletedEventCount = 0;

      while (throughSequence > 0) {
        const rows = yield* sql<{
          readonly sequence: number;
          readonly application_event_version: number;
          readonly aggregate_kind: string;
          readonly stream_id: string;
          readonly event_type: string;
          readonly entity_id: string | null;
        }>`
          SELECT
            event.sequence,
            event.application_event_version,
            event.aggregate_kind,
            event.stream_id,
            event.event_type,
            CASE
              WHEN event.application_event_version = 2
                AND event.event_type IN ('message.updated', 'node.updated')
              THEN json_extract(event.payload_json, '$.id')
              WHEN event.application_event_version = 2
                AND event.event_type = 'turn-item.updated'
                AND event.command_id IS NULL
                AND json_extract(event.payload_json, '$.type') <> 'subagent'
              THEN json_extract(event.payload_json, '$.id')
              WHEN event.application_event_version = 2
                AND event.event_type = 'thread.pull-request-link-updated'
              THEN json_array(json_extract(event.payload_json, '$.host'),
                json_extract(event.payload_json, '$.repository'),
                json_extract(event.payload_json, '$.number'))
              ELSE NULL
            END AS entity_id
          FROM orchestration_events AS event
          WHERE event.sequence <= ${throughSequence}
          ORDER BY event.sequence DESC
          LIMIT ${COMPACTION_PAGE_SIZE + 1}
        `.pipe(NodeSqliteClient.readOnly);
        const page = rows.slice(0, COMPACTION_PAGE_SIZE);
        const obsolete: number[] = [];
        for (const row of page) {
          if (row.application_event_version === 2) {
            if (
              row.aggregate_kind === "thread" &&
              supersedableThreadEventTypes.has(row.event_type)
            ) {
              if (retainedThreadIds.has(row.stream_id)) obsolete.push(row.sequence);
              else retainedThreadIds.add(row.stream_id);
            } else if (
              row.aggregate_kind === "thread" &&
              readStateThreadEventTypes.has(row.event_type)
            ) {
              if (
                retainedThreadIds.has(row.stream_id) ||
                retainedReadStateThreadIds.has(row.stream_id)
              ) {
                obsolete.push(row.sequence);
              } else retainedReadStateThreadIds.add(row.stream_id);
            } else if (
              row.event_type === "thread.visit-recorded" &&
              (retainedThreadIds.has(row.stream_id) ||
                retainedReadStateThreadIds.has(row.stream_id))
            ) {
              // A visit carries read state only, so only a newer whole-thread payload covers it.
              obsolete.push(row.sequence);
            } else if (
              row.event_type === "thread.pull-request-link-updated" &&
              retainedThreadIds.has(row.stream_id)
            ) {
              // A newer whole-thread payload already carries this link's state.
              obsolete.push(row.sequence);
            } else if (
              row.event_type === "thread.pull-request-link-updated" ||
              row.event_type === "message.updated" ||
              row.event_type === "node.updated" ||
              (row.event_type === "turn-item.updated" && row.entity_id !== null)
            ) {
              const key = encodeEntityKey([row.event_type, row.stream_id, row.entity_id]);
              const candidate = oldestCandidateByEntityKey.get(key);
              if (candidate === undefined) oldestCandidateByEntityKey.set(key, null);
              else {
                if (candidate !== null) obsolete.push(candidate);
                oldestCandidateByEntityKey.set(key, row.sequence);
              }
            }
          }
        }
        // Never hold a transaction or the reader lock across a yield or a rest.
        yield* Effect.yieldNow;
        if (obsolete.length > 0) {
          yield* sql`DELETE FROM orchestration_events WHERE sequence IN ${sql.in(obsolete)}`;
          deletedEventCount += obsolete.length;
          yield* Effect.yieldNow;
        }
        throughSequence =
          rows.length <= COMPACTION_PAGE_SIZE ? 0 : (page.at(-1)?.sequence ?? 1) - 1;
        if (throughSequence > 0) yield* betweenPages;
      }

      const freelistRows = yield* sql<{ readonly freelist_count: number }>`PRAGMA freelist_count`;
      const pageSizeRows = yield* sql<{ readonly page_size: number }>`PRAGMA page_size`;
      const reclaimableBytes =
        (freelistRows[0]?.freelist_count ?? 0) * (pageSizeRows[0]?.page_size ?? 0);

      return { deletedEventCount, reclaimableBytes };
    }, mapError("compact event store"));

    const writeMetadata = (name: string, sequence: number, at: DateTime.Utc) => sql`
      INSERT INTO orchestration_v2_projection_metadata (
        projection_name, schema_version, last_sequence, updated_at
      )
      VALUES (
        ${name},
        ${ProjectionStore.ORCHESTRATION_V2_PROJECTION_SCHEMA_VERSION},
        ${sequence},
        ${DateTime.formatIso(at)}
      )
      ON CONFLICT(projection_name) DO UPDATE SET
        last_sequence = excluded.last_sequence,
        updated_at = excluded.updated_at
    `;

    // Collects anchors whose prompt later rows borrow through promptSequence.
    const readPromptReferences = Effect.fnUntraced(function* (
      afterSequence: number,
      throughSequence: number,
      betweenPages: Effect.Effect<void>,
    ) {
      const referenced = new Set<number>();
      for (let cursor = afterSequence; cursor < throughSequence;) {
        const windowEnd = Math.min(cursor + REFERENCE_SCAN_WINDOW, throughSequence);
        const rows = yield* sql<{ readonly prompt_sequence: number }>`
          SELECT json_extract(payload_json, '$.promptSequence') AS prompt_sequence
          FROM orchestration_events
          WHERE sequence > ${cursor}
            AND sequence <= ${windowEnd}
            AND event_type IN ('subagent.updated', 'turn-item.updated')
            AND json_type(payload_json, '$.promptSequence') = 'integer'
        `.pipe(NodeSqliteClient.readOnly);
        for (const row of rows) referenced.add(row.prompt_sequence);
        cursor = windowEnd;
        yield* betweenPages;
      }
      return referenced;
    });

    const pruneEvents = Effect.fnUntraced(function* (
      throughSequence: number,
      head: number,
      betweenPages: Effect.Effect<void>,
      mode: "delete" | "count",
    ) {
      const referenced = yield* readPromptReferences(throughSequence, head, betweenPages);
      // Stream heads at or below the boundary are kept, so the anchors they borrow must stay too.
      const keptHeadReferences = yield* sql<{ readonly prompt_sequence: number }>`
        SELECT json_extract(event.payload_json, '$.promptSequence') AS prompt_sequence
        FROM (
          SELECT MAX(sequence) AS sequence FROM orchestration_events
          GROUP BY aggregate_kind, stream_id
        ) AS heads
        JOIN orchestration_events AS event ON event.sequence = heads.sequence
        WHERE heads.sequence <= ${throughSequence}
          AND event.event_type IN ('subagent.updated', 'turn-item.updated')
          AND json_type(event.payload_json, '$.promptSequence') = 'integer'
      `.pipe(NodeSqliteClient.readOnly);
      for (const row of keptHeadReferences) referenced.add(row.prompt_sequence);
      yield* betweenPages;
      let referencesThrough = head;
      let deleted = 0;
      let cursor = 0;
      while (cursor < throughSequence) {
        const rows = yield* sql<{ readonly sequence: number; readonly prunable: number }>`
          SELECT
            event.sequence,
            CASE
              -- No projection covers v1 rows; this build has no importer to fold them in.
              WHEN event.application_event_version = 1 THEN 0
              -- The replay oracle derives the thread set from thread.created; thread resume reads it.
              WHEN event.event_type = 'thread.created' THEN 0
              -- Codex usage history reads the selection a run attempt started with.
              WHEN event.event_type = 'run.updated'
                AND json_extract(event.payload_json, '$.status') = 'running' THEN 0
              -- The newest row keeps each stream's high water, stream_version, and snapshot sequence.
              WHEN event.sequence = (
                SELECT MAX(newer.sequence) FROM orchestration_events AS newer
                WHERE newer.aggregate_kind = event.aggregate_kind
                  AND newer.stream_id = event.stream_id
              ) THEN 0
              ELSE 1
            END AS prunable
          FROM orchestration_events AS event
          WHERE event.sequence > ${cursor}
            AND event.sequence <= ${throughSequence}
          ORDER BY event.sequence ASC
          LIMIT ${PAGE_SIZE}
        `.pipe(NodeSqliteClient.readOnly);
        const candidates = rows.filter((row) => row.prunable === 1).map((row) => row.sequence);
        // Never hold a transaction or the reader lock across a yield or a rest.
        yield* Effect.yieldNow;
        if (mode === "count") {
          deleted += candidates.filter((sequence) => !referenced.has(sequence)).length;
        } else if (candidates.length > 0) {
          deleted += yield* sql.withTransaction(
            Effect.gen(function* () {
              // Rows appended since the reference scan may borrow a prompt from a candidate.
              const appended = yield* sql<{
                readonly sequence: number;
                readonly prompt_sequence: number | null;
              }>`
                SELECT
                  sequence,
                  CASE
                    WHEN event_type IN ('subagent.updated', 'turn-item.updated')
                      AND json_type(payload_json, '$.promptSequence') = 'integer'
                    THEN json_extract(payload_json, '$.promptSequence')
                  END AS prompt_sequence
                FROM orchestration_events
                WHERE sequence > ${referencesThrough}
              `;
              for (const row of appended) {
                if (row.prompt_sequence !== null) referenced.add(row.prompt_sequence);
                referencesThrough = Math.max(referencesThrough, row.sequence);
              }
              const obsolete = candidates.filter((sequence) => !referenced.has(sequence));
              if (obsolete.length === 0) return 0;
              yield* sql`DELETE FROM orchestration_events WHERE sequence IN ${sql.in(obsolete)}`;
              return obsolete.length;
            }),
          );
          yield* Effect.yieldNow;
        }
        // Rest after every page, including the last, so the next loop starts a fresh slice.
        yield* betweenPages;
        if (rows.length < PAGE_SIZE) break;
        cursor = rows.at(-1)?.sequence ?? throughSequence;
      }
      return deleted;
    });

    const readPruneState = Effect.fnUntraced(function* () {
      const now = yield* DateTime.now;
      const metadata = yield* sql<MetadataRow>`
        SELECT projection_name, last_sequence, updated_at
        FROM orchestration_v2_projection_metadata
        WHERE projection_name IN (
          'thread-projections', ${EVENT_LOG_PRUNE_MARK}, ${EVENT_LOG_PRUNED_THROUGH}
        )
      `.pipe(NodeSqliteClient.readOnly);
      const read = (name: string) => metadata.find((row) => row.projection_name === name);
      const projected = read("thread-projections")?.last_sequence ?? 0;
      const mark = read(EVENT_LOG_PRUNE_MARK);
      const prunedThroughRow = read(EVENT_LOG_PRUNED_THROUGH);
      const prunedThrough = prunedThroughRow?.last_sequence ?? 0;
      // Fixed bounds: foreground commits during the pass wait for the next one.
      const bounds = yield* sql<{ readonly sequence: number }>`
        SELECT COALESCE((SELECT MAX(sequence) FROM orchestration_events), 0) AS sequence
      `.pipe(NodeSqliteClient.readOnly);
      const dueAt = (marked: MetadataRow) =>
        DateTime.add(DateTime.makeUnsafe(marked.updated_at), {
          milliseconds: Duration.toMillis(RETAINED_EVENT_HISTORY),
        });
      const schedule: EventLogPruneSchedule =
        mark === undefined
          ? { _tag: "Unmarked" }
          : DateTime.isLessThan(now, dueAt(mark))
            ? { _tag: "Waiting", dueAt: dueAt(mark) }
            : {
                _tag: "Due",
                throughSequence: Math.max(Math.min(mark.last_sequence, projected), prunedThrough),
              };
      return {
        now,
        head: bounds[0]?.sequence ?? 0,
        schedule,
        prunedThrough,
        // The first boundary a pass publishes needs a backup; later ones extend a pruned log.
        publishesFirstBoundary:
          prunedThroughRow === undefined &&
          schedule._tag === "Due" &&
          schedule.throughSequence > prunedThrough,
      };
    });

    // A pass prunes through the mark the previous pass left once that mark is a day old, so
    // at least RETAINED_EVENT_HISTORY of events always remains. Receipts stay for idempotency.
    const pruneEventStore = Effect.fn("ProjectionMaintenance.pruneEventStore")(function* <
      E,
    >(options: {
      readonly backUp: Effect.Effect<unknown, E>;
      readonly betweenPages?: Effect.Effect<void>;
    }) {
      const betweenPages = options.betweenPages ?? Effect.void;
      const { now, head, schedule, prunedThrough, publishesFirstBoundary } =
        yield* readPruneState();
      let deletedEventCount = 0;
      if (schedule._tag === "Due") {
        if (publishesFirstBoundary) yield* options.backUp;
        if (schedule.throughSequence > prunedThrough) {
          // Publish the boundary first so resuming clients take a snapshot, never a partial replay.
          yield* writeMetadata(EVENT_LOG_PRUNED_THROUGH, schedule.throughSequence, now);
        }
        deletedEventCount += yield* pruneEvents(
          schedule.throughSequence,
          head,
          betweenPages,
          "delete",
        );
      }
      if (schedule._tag !== "Waiting") yield* writeMetadata(EVENT_LOG_PRUNE_MARK, head, now);

      const freelistRows = yield* sql<{ readonly freelist_count: number }>`PRAGMA freelist_count`;
      const pageSizeRows = yield* sql<{ readonly page_size: number }>`PRAGMA page_size`;
      const reclaimableBytes =
        (freelistRows[0]?.freelist_count ?? 0) * (pageSizeRows[0]?.page_size ?? 0);

      return { schedule, deletedEventCount, reclaimableBytes };
    }, mapError("prune event store"));

    const previewEventStorePrune = Effect.gen(function* () {
      const { head, schedule, publishesFirstBoundary } = yield* readPruneState();
      const prunableEventCount =
        schedule._tag === "Due"
          ? yield* pruneEvents(schedule.throughSequence, head, Effect.void, "count")
          : 0;
      const counts = yield* sql<{ readonly event_count: number }>`
        SELECT COUNT(*) AS event_count FROM orchestration_events
      `.pipe(NodeSqliteClient.readOnly);
      return {
        schedule,
        prunableEventCount,
        eventCount: counts[0]?.event_count ?? 0,
        backupNeeded: publishesFirstBoundary,
      };
    }).pipe(
      Effect.withSpan("ProjectionMaintenance.previewEventStorePrune"),
      mapError("preview prune"),
    );

    return ProjectionMaintenanceV2.of({
      compactEventStore,
      pruneEventStore,
      previewEventStorePrune,
    });
  }),
);
