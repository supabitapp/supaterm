import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Remote task reads skip unreadable payloads. Migration 23's index stays as released builds
  // name it, so this one takes its own name; keep the predicate aligned with ProjectionStore.
  yield* sql`
    CREATE INDEX IF NOT EXISTS orchestration_v2_projection_subagents_remote_json_idx
    ON orchestration_v2_projection_subagents(thread_id, subagent_id)
    WHERE origin = 'app_owned'
      AND child_thread_id IS NULL
      AND CASE WHEN json_valid(payload_json)
        THEN json_type(payload_json, '$.remoteChild') = 'object'
          OR json_type(payload_json, '$.remoteLaunch') = 'object'
        ELSE 0 END
  `;
});
