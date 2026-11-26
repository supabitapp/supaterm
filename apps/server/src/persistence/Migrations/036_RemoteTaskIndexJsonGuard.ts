import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Migration 23 now skips unreadable payloads; a partial index is only used when its predicate
  // spells the read's condition, so rebuild the one it made before.
  yield* sql`DROP INDEX IF EXISTS orchestration_v2_projection_subagents_remote_idx`;
  yield* sql`
    CREATE INDEX orchestration_v2_projection_subagents_remote_idx
    ON orchestration_v2_projection_subagents(thread_id, subagent_id)
    WHERE origin = 'app_owned'
      AND child_thread_id IS NULL
      AND CASE WHEN json_valid(payload_json)
        THEN json_type(payload_json, '$.remoteChild') = 'object'
          OR json_type(payload_json, '$.remoteLaunch') = 'object'
        ELSE 0 END
  `;
});
