import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE INDEX orchestration_v2_projection_turn_items_active_ordinal_idx
    ON orchestration_v2_projection_turn_items(thread_id, ordinal, turn_item_id)
    WHERE status IN ('pending', 'running', 'waiting')
  `;
  yield* sql`
    CREATE INDEX orchestration_v2_projection_turn_items_active_run_idx
    ON orchestration_v2_projection_turn_items(thread_id, run_id)
    WHERE status IN ('pending', 'running', 'waiting')
  `;
});
