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

const layer = it.layer(NodeSqliteClient.layer({ filename: ":memory:" }));

layer("016_ProjectionProjectsCustomTitle", (it) => {
  it.effect("marks projects with a recorded title update as renamed", () =>
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
        }),
      });
      for (const projectId of ["renamed", "untouched"]) {
        yield* sql`
          INSERT INTO projection_projects
            (project_id, title, workspace_root, scripts_json, created_at, updated_at)
          VALUES (${projectId}, 'repo', ${"/tmp/" + projectId}, '[]', '2026-10-01', '2026-10-01')
        `;
        yield* sql`
          INSERT INTO orchestration_events
            (event_id, aggregate_kind, stream_id, stream_version, event_type, occurred_at,
             actor_kind, payload_json, metadata_json, application_event_version)
          VALUES (${projectId}, 'project', ${projectId}, 1, 'project.meta-updated', '2026-10-01',
            'client', ${JSON.stringify(projectId === "renamed" ? { title: "repo" } : { autoPull: true })}, '{}', 2)
        `;
      }
      yield* runMigrations();
      assert.deepStrictEqual(
        yield* sql`SELECT project_id, has_custom_title FROM projection_projects ORDER BY project_id`,
        [
          { project_id: "renamed", has_custom_title: 1 },
          { project_id: "untouched", has_custom_title: 0 },
        ],
      );
    }),
  );
});
