import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // One row per project bound to a standalone issue tracker (Linear, Jira): which tracker and
  // which of its scopes (a team or project key). Unbinding deletes the row; a project with no row
  // reads only its git host's issues. The credential itself lives in the secret store.
  yield* sql`
    CREATE TABLE IF NOT EXISTS issue_tracker_bindings (
      project_id TEXT PRIMARY KEY,
      tracker TEXT NOT NULL,
      scope TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      additional_scopes TEXT NOT NULL DEFAULT '[]',
      account_id TEXT
    ) WITHOUT ROWID
  `;

  // Accounts added beside a standalone tracker's first one. The first keeps no row and binds
  // with a null account_id.
  yield* sql`
    CREATE TABLE IF NOT EXISTS issue_tracker_accounts (
      tracker TEXT NOT NULL,
      account_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (tracker, account_id)
    ) WITHOUT ROWID
  `;
});
