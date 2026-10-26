import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

const OCCURRED_AT = "2026-01-05T00:00:00.000Z";
let nextEventId = 0;

/**
 * Writes one event row directly, for rows the store would not append: unknown
 * types from a newer build, legacy versions, or a chosen sequence.
 */
export const insertOrchestrationEventRow = Effect.fnUntraced(function* (row: {
  readonly aggregateKind: "project" | "thread";
  readonly streamId: string;
  readonly eventType?: string;
  readonly payload?: string;
  readonly applicationEventVersion?: number;
  readonly sequence?: number;
}) {
  const sql = yield* SqlClient.SqlClient;
  const eventType =
    row.eventType ??
    (row.aggregateKind === "thread" ? "provider-session.detached" : "project.meta-updated");
  const payload =
    row.payload ??
    (row.aggregateKind === "thread"
      ? `{"providerSessionId":"session:test","detachedAt":"${OCCURRED_AT}"}`
      : `{"projectId":"${row.streamId}","updatedAt":"${OCCURRED_AT}"}`);
  const [inserted] = yield* sql<{ readonly sequence: number }>`
    INSERT INTO orchestration_events (
      sequence, event_id, aggregate_kind, stream_id, stream_version, event_type,
      occurred_at, actor_kind, payload_json, metadata_json, application_event_version
    ) VALUES (
      ${row.sequence ?? null}, ${`test-event:${nextEventId++}`}, ${row.aggregateKind},
      ${row.streamId},
      (
        SELECT COALESCE(MAX(stream_version) + 1, 0) FROM orchestration_events
        WHERE aggregate_kind = ${row.aggregateKind} AND stream_id = ${row.streamId}
      ),
      ${eventType}, ${OCCURRED_AT}, 'server', ${payload}, '{}',
      ${row.applicationEventVersion ?? 2}
    ) RETURNING sequence
  `;
  return inserted!.sequence;
});
