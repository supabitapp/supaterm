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

const layer = it.layer(NodeSqliteClient.layer({ filename: ":memory:" }));

layer("014_TurnItemCounts", (it) => {
  it.effect("backfills item counts, then follows upserts, moves, and deletes", () =>
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
        }),
      });
      const upsert = (id: string, threadId: string, runId: string | null) => sql`
        INSERT INTO orchestration_v2_projection_turn_items (
          turn_item_id, thread_id, run_id, ordinal, type, status, updated_at, payload_json
        )
        VALUES (
          ${id}, ${threadId}, ${runId}, 1, 'assistant_message', 'completed',
          '2026-10-29T00:00:00.000Z', '{}'
        )
        ON CONFLICT(turn_item_id) DO UPDATE SET
          thread_id = excluded.thread_id,
          run_id = excluded.run_id,
          status = excluded.status
      `;
      yield* upsert("runless-1", "thread-1", null);
      yield* upsert("runless-2", "thread-1", null);
      yield* upsert("run-1", "thread-1", "run-1");

      yield* runMigrations();

      const counts = () =>
        sql<{ readonly thread_id: string; readonly run_key: string; readonly item_count: number }>`
          SELECT thread_id, run_key, item_count
          FROM orchestration_v2_projection_turn_item_counts
          ORDER BY thread_id, run_key
        `;
      assert.deepEqual(yield* counts(), [
        { thread_id: "thread-1", run_key: "", item_count: 2 },
        { thread_id: "thread-1", run_key: "run-1", item_count: 1 },
      ]);

      yield* upsert("run-1", "thread-1", "run-1");
      yield* upsert("run-2", "thread-2", "run-2");
      yield* upsert("runless-2", "thread-1", "run-1");
      assert.deepEqual(yield* counts(), [
        { thread_id: "thread-1", run_key: "", item_count: 1 },
        { thread_id: "thread-1", run_key: "run-1", item_count: 2 },
        { thread_id: "thread-2", run_key: "run-2", item_count: 1 },
      ]);

      yield* sql`DELETE FROM orchestration_v2_projection_turn_items WHERE thread_id = 'thread-1'`;
      assert.deepEqual(yield* counts(), [
        { thread_id: "thread-2", run_key: "run-2", item_count: 1 },
      ]);
    }),
  );
});
