import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    UPDATE orchestration_v2_projection_threads
    SET payload_json = json_set(payload_json, '$.titleRegeneration', json('null'))
    WHERE json_valid(payload_json)
      AND json_type(payload_json, '$.titleRegeneration') = 'object'
      AND NOT EXISTS (
        SELECT 1 FROM orchestration_v2_effect_outbox AS job
        WHERE job.effect_type = 'thread-title.generate'
          AND job.thread_id = orchestration_v2_projection_threads.thread_id
          AND job.command_id =
            json_extract(orchestration_v2_projection_threads.payload_json, '$.titleRegeneration.requestId')
          AND job.status IN ('pending', 'running')
      )
  `;
});
