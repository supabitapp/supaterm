import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Other environments this one signed in to as an outside MCP agent. The
  // session token itself is kept in the server secret store under
  // `secret_name`, which is unique to each link, so a row always names its
  // own token even when two links to one environment race.
  yield* sql`
    CREATE TABLE IF NOT EXISTS peer_environment_links (
      environment_id TEXT PRIMARY KEY,
      secret_name TEXT NOT NULL,
      label TEXT NOT NULL,
      urls_json TEXT NOT NULL,
      access TEXT NOT NULL,
      linked_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_reached_at TEXT,
      last_error TEXT,
      relay_url TEXT
    )
  `;

  // Released builds read remote tasks through this index by name, with this predicate. The
  // predicate fails on an unreadable payload, so a database holding one goes without it.
  const unreadable = yield* sql`
    SELECT 1 FROM orchestration_v2_projection_subagents WHERE NOT json_valid(payload_json) LIMIT 1
  `;
  if (unreadable.length === 0) {
    yield* sql`
      CREATE INDEX IF NOT EXISTS orchestration_v2_projection_subagents_remote_idx
      ON orchestration_v2_projection_subagents(thread_id, subagent_id)
      WHERE origin = 'app_owned'
        AND child_thread_id IS NULL
        AND (
          json_type(payload_json, '$.remoteChild') = 'object'
          OR json_type(payload_json, '$.remoteLaunch') = 'object'
        )
    `;
  }

  // Keep this predicate aligned with ProjectionStore's waiting link card query.
  yield* sql`
    CREATE INDEX IF NOT EXISTS orchestration_v2_projection_turn_items_waiting_link_idx
    ON orchestration_v2_projection_turn_items(thread_id, updated_at DESC, turn_item_id DESC)
    WHERE type = 'link_request' AND status = 'waiting'
  `;
});
