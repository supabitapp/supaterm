import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE INDEX IF NOT EXISTS orchestration_v2_projection_threads_worktree_path_idx
    ON orchestration_v2_projection_threads(
      CASE WHEN json_valid(payload_json) THEN json_extract(payload_json, '$.worktreePath') END
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS orchestration_v2_projection_threads_root_thread_idx
    ON orchestration_v2_projection_threads(
      CASE WHEN json_valid(payload_json) THEN json_extract(payload_json, '$.lineage.rootThreadId') END
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS orchestration_v2_projection_runs_run_status_idx
    ON orchestration_v2_projection_runs(run_id, status)
  `;
});
