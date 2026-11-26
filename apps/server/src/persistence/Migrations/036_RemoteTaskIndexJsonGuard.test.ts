import { assert, it } from "@effect/vitest";
import { NodeId, ThreadId } from "@supaterm/contracts";
import * as NodeSqliteClient from "@supaterm/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import { runMigrations } from "../Migrations.ts";

const layer = it.layer(
  ProjectionStore.layer.pipe(Layer.provideMerge(NodeSqliteClient.layer({ filename: ":memory:" }))),
);

layer("036_RemoteTaskIndexJsonGuard", (it) => {
  it.effect("keeps remote task reads working on a database that built the shipped index", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 35 });
      yield* sql`DROP INDEX orchestration_v2_projection_subagents_remote_idx`;
      yield* sql`
        CREATE INDEX orchestration_v2_projection_subagents_remote_idx
        ON orchestration_v2_projection_subagents(thread_id, subagent_id)
        WHERE origin = 'app_owned'
          AND child_thread_id IS NULL
          AND (
            json_type(payload_json, '$.remoteChild') = 'object'
            OR json_type(payload_json, '$.remoteLaunch') = 'object'
          )
      `;
      yield* sql`
        INSERT INTO orchestration_v2_projection_subagents (
          subagent_id, thread_id, parent_node_id, provider, origin, status, updated_at, payload_json
        )
        VALUES (
          'task-1', 'thread-1', 'root', 'codex', 'app_owned', 'running',
          '2026-11-01T00:00:00.000Z', ${JSON.stringify({ remoteChild: {}, result: null })}
        )
      `;

      yield* runMigrations();

      const projections = yield* ProjectionStore.ProjectionStoreV2;
      assert.deepStrictEqual(yield* projections.getOpenRemoteDelegatedTasks, [
        { parentThreadId: ThreadId.make("thread-1"), taskId: NodeId.make("task-1") },
      ]);
    }),
  );
});
