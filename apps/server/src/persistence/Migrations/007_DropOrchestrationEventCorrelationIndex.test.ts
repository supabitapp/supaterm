import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@supaterm/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import * as Migrator from "effect/sql/Migrator";

import { runMigrations } from "../Migrations.ts";
import Migration0001 from "./001_Baseline.ts";
import Migration0002 from "./002_ThreadMessageSearch.ts";
import Migration0003 from "./003_ActiveTurnItemIndexes.ts";
import Migration0004 from "./004_ExcludeAttachmentPlaceholdersFromSearch.ts";
import Migration0005 from "./005_SubagentDeliveryState.ts";
import Migration0006 from "./006_ProjectionProjectsPinArchive.ts";

it.effect("drops the unused correlation index and keeps correlation values", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* Migrator.make({})({
      loader: Migrator.fromRecord({
        "1_Baseline": Migration0001,
        "2_ThreadMessageSearch": Migration0002,
        "3_ActiveTurnItemIndexes": Migration0003,
        "4_ExcludeAttachmentPlaceholdersFromSearch": Migration0004,
        "5_SubagentDeliveryState": Migration0005,
        "6_ProjectionProjectsPinArchive": Migration0006,
      }),
    });
    yield* sql`
      INSERT INTO orchestration_events (
        event_id, aggregate_kind, stream_id, stream_version, event_type, occurred_at,
        command_id, causation_event_id, correlation_id, actor_kind, payload_json, metadata_json
      )
      VALUES (
        'event-1', 'thread', 'thread-1', 0, 'thread.created', '2026-01-01T00:00:00.000Z',
        'command-1', NULL, 'correlation-1', 'client', '{}', '{}'
      )
    `;

    yield* runMigrations();

    const indexes = yield* sql<{ readonly name: string }>`
      SELECT name FROM sqlite_master
      WHERE type = 'index' AND tbl_name = 'orchestration_events' AND sql IS NOT NULL
    `;
    const indexNames = indexes.map((row) => row.name);
    assert.notInclude(indexNames, "idx_orch_events_correlation_id");
    for (const kept of [
      "idx_orch_events_stream_version",
      "idx_orch_events_stream_sequence",
      "idx_orch_events_command_id",
      "idx_orchestration_events_agent_stream_sequence",
    ]) {
      assert.include(indexNames, kept);
    }
    const events = yield* sql<{ readonly correlation_id: string | null }>`
      SELECT correlation_id FROM orchestration_events WHERE event_id = 'event-1'
    `;
    assert.deepStrictEqual(events, [{ correlation_id: "correlation-1" }]);
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);
