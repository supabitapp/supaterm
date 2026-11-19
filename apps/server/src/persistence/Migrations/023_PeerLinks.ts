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

  // Keep this predicate aligned with ProjectionStore's remote task reads.
  yield* sql`
    CREATE INDEX IF NOT EXISTS orchestration_v2_projection_subagents_remote_idx
    ON orchestration_v2_projection_subagents(thread_id, subagent_id)
    WHERE origin = 'app_owned'
      AND child_thread_id IS NULL
      AND json_type(payload_json, '$.remoteChild') = 'object'
  `;
});
