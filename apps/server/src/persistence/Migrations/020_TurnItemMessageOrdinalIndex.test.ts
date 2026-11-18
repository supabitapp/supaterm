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
import Migration0015 from "./015_QueuedTurnInputIndex.ts";
import Migration0016 from "./016_ProjectionProjectsCustomTitle.ts";
import Migration0017 from "./017_TurnItemTypeStatusIndex.ts";
import Migration0018 from "./018_ShellThreadReadIndexes.ts";
import Migration0019 from "./019_ProviderTurnAttemptIndex.ts";

const ordinalsOf = (threadId: string) => `
  SELECT json_extract(payload_json, '$.messageId') AS message_id, MIN(ordinal) AS ordinal
  FROM orchestration_v2_projection_turn_items
  WHERE thread_id = '${threadId}' AND type IN ('user_message', 'assistant_message')
    AND json_valid(payload_json)
  GROUP BY json_extract(payload_json, '$.messageId')
  ORDER BY message_id
`;

const insertTurnItem = (
  id: string,
  threadId: string,
  ordinal: number,
  type: string,
  payloadJson: string,
) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      INSERT INTO orchestration_v2_projection_turn_items (
        turn_item_id, thread_id, run_id, ordinal, type, status, updated_at, payload_json
      )
      VALUES (
        ${id}, ${threadId}, NULL, ${ordinal}, ${type}, 'completed',
        '2026-11-01T00:00:00.000Z', ${payloadJson}
      )
    `;
  });

// Without the index a payload that is not JSON fails no write; with it, it must fail none either.
it.effect("migrates over a message whose payload is not JSON, and takes one after it", () =>
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
        "15_QueuedTurnInputIndex": Migration0015,
        "16_ProjectionProjectsCustomTitle": Migration0016,
        "17_TurnItemTypeStatusIndex": Migration0017,
        "18_ShellThreadReadIndexes": Migration0018,
        "19_ProviderTurnAttemptIndex": Migration0019,
      }),
    });
    yield* insertTurnItem("bad-1", "thread-a", 1, "assistant_message", "{not json");
    yield* insertTurnItem("ok-1", "thread-a", 2, "user_message", '{"messageId":"m1"}');

    assert.deepEqual(
      (yield* runMigrations({ toMigrationInclusive: 20 })).map(([id]) => id),
      [20],
    );
    yield* insertTurnItem("bad-2", "thread-a", 3, "user_message", "{not json");
    yield* insertTurnItem("ok-2", "thread-a", 4, "assistant_message", '{"messageId":"m1"}');
    yield* sql`
      UPDATE orchestration_v2_projection_turn_items SET payload_json = '{still not json'
      WHERE turn_item_id = 'ok-2'
    `;

    assert.deepEqual(yield* sql.unsafe(ordinalsOf("thread-a")), [{ message_id: "m1", ordinal: 2 }]);
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);
