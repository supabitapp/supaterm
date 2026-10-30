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

it.effect("backfills each stored subagent's completion delivery state", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* Migrator.make({})({
      loader: Migrator.fromRecord({
        "1_Baseline": Migration0001,
        "2_ThreadMessageSearch": Migration0002,
        "3_ActiveTurnItemIndexes": Migration0003,
        "4_ExcludeAttachmentPlaceholdersFromSearch": Migration0004,
      }),
    });
    const subagents = [
      ["delivered", { completionDelivery: { state: "delivered" } }],
      ["pending", { completionDelivery: { state: "pending" } }],
      ["none", {}],
    ] as const;
    for (const [id, payload] of subagents) {
      yield* sql`
        INSERT INTO orchestration_v2_projection_subagents (
          subagent_id, thread_id, parent_node_id, provider, origin, status, updated_at, payload_json
        )
        VALUES (
          ${id}, 'thread-1', 'root', 'codex', 'app_owned', 'completed',
          '2026-09-01T00:00:00.000Z', ${JSON.stringify(payload)}
        )
      `;
    }

    yield* runMigrations();

    const rows = yield* sql<{ readonly id: string; readonly state: string | null }>`
      SELECT subagent_id AS id, completion_delivery_state AS state
      FROM orchestration_v2_projection_subagents
      ORDER BY subagent_id
    `;
    assert.deepEqual(rows, [
      { id: "delivered", state: "delivered" },
      { id: "none", state: null },
      { id: "pending", state: "pending" },
    ]);
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);
