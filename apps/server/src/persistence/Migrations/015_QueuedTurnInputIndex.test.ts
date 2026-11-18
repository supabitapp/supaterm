import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@supaterm/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Migrator from "effect/sql/Migrator";
import * as SqlClient from "effect/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import Migration0001 from "./001_Baseline.ts";
import Migration0002 from "./002_ThreadMessageSearch.ts";
import Migration0003 from "./003_ActiveTurnItemIndexes.ts";
import Migration0004 from "./004_ExcludeAttachmentPlaceholdersFromSearch.ts";
import Migration0005 from "./005_SubagentDeliveryState.ts";
import Migration0006 from "./006_ProjectionProjectsPinArchive.ts";
import Migration0007 from "./007_DropOrchestrationEventCorrelationIndex.ts";
import Migration0008 from "./008_DelegatedRecoveryIndexes.ts";
import Migration0009 from "./009_ScheduledTaskThreadMode.ts";
import Migration0010 from "./010_ProjectionMessageSearchText.ts";
import Migration0011 from "./011_TurnItemConversationIndex.ts";
import Migration0012 from "./012_CommandReadIndexes.ts";
import Migration0013 from "./013_LastExecutedRunIndex.ts";
import Migration0014 from "./014_TurnItemCounts.ts";

const layer = it.layer(NodeSqliteClient.layer({ filename: ":memory:" }));

layer("015_QueuedTurnInputIndex", (it) => {
  it.effect("keeps a user message with a malformed payload migratable and writable", () =>
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
          "7_DropOrchestrationEventCorrelationIndex": Migration0007,
          "8_DelegatedRecoveryIndexes": Migration0008,
          "9_ScheduledTaskThreadMode": Migration0009,
          "10_ProjectionMessageSearchText": Migration0010,
          "11_TurnItemConversationIndex": Migration0011,
          "12_CommandReadIndexes": Migration0012,
          "13_LastExecutedRunIndex": Migration0013,
          "14_TurnItemCounts": Migration0014,
        }),
      });
      const insertUserMessage = (id: string) => sql`
        INSERT INTO orchestration_v2_projection_turn_items (
          turn_item_id, thread_id, run_id, ordinal, type, status, updated_at, payload_json
        )
        VALUES (
          ${id}, 'thread-1', 'run-1', 1, 'user_message', 'completed',
          '2026-11-14T00:00:00.000Z', '{not json'
        )
      `;
      yield* insertUserMessage("before-15");

      yield* runMigrations();
      yield* insertUserMessage("after-15");

      const rows = yield* sql<{ readonly turn_item_id: string }>`
        SELECT turn_item_id FROM orchestration_v2_projection_turn_items ORDER BY turn_item_id
      `;
      assert.deepEqual(
        rows.map((row) => row.turn_item_id),
        ["after-15", "before-15"],
      );
    }),
  );
});
