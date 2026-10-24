import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export const ensurePushNotificationsSchema = Effect.fn("ensurePushNotificationsSchema")(
  function* () {
    const sql = yield* SqlClient.SqlClient;

    const addMissingColumn = Effect.fnUntraced(function* (
      table: string,
      column: string,
      definition: string,
    ) {
      const columns = yield* sql<{ readonly name: string }>`
        SELECT name FROM pragma_table_info(${table})
      `;
      if (columns.some((row) => row.name === column)) return;
      yield* sql.unsafe(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    });

    yield* sql`
    CREATE TABLE IF NOT EXISTS push_registrations (
      registration_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      gateway_origin TEXT NOT NULL,
      handle TEXT NOT NULL,
      key_id TEXT NOT NULL,
      recipient_public_key TEXT NOT NULL,
      preview TEXT NOT NULL,
      kinds_json TEXT NOT NULL,
      device_name TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_delivery_at TEXT,
      revision INTEGER NOT NULL DEFAULT 0
    )
  `;
    yield* addMissingColumn("push_registrations", "revision", "INTEGER NOT NULL DEFAULT 0");
    yield* sql`
    CREATE INDEX IF NOT EXISTS push_registrations_session_idx ON push_registrations(session_id)
  `;
    yield* sql`DROP TABLE IF EXISTS push_thread_attention`;
    yield* sql`
    CREATE TABLE IF NOT EXISTS push_deliveries (
      delivery_id INTEGER PRIMARY KEY AUTOINCREMENT,
      registration_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      attention_key TEXT NOT NULL,
      kind TEXT NOT NULL,
      occurred_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      status TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at INTEGER NOT NULL,
      lease_until INTEGER,
      envelope_json TEXT,
      envelope_expires_at INTEGER,
      notification_id TEXT NOT NULL,
      request_thread_id TEXT,
      request_id TEXT,
      envelope_revision INTEGER,
      UNIQUE (registration_id, thread_id, attention_key)
    )
  `;
    yield* addMissingColumn("push_deliveries", "request_thread_id", "TEXT");
    yield* addMissingColumn("push_deliveries", "request_id", "TEXT");
    yield* addMissingColumn("push_deliveries", "envelope_revision", "INTEGER");
    yield* sql`
    CREATE INDEX IF NOT EXISTS push_deliveries_due_idx ON push_deliveries(status, next_attempt_at)
  `;
    yield* sql`
    CREATE INDEX IF NOT EXISTS push_deliveries_thread_idx ON push_deliveries(thread_id, status)
  `;
    yield* sql`
    CREATE INDEX IF NOT EXISTS push_deliveries_request_idx
    ON push_deliveries(request_thread_id, request_id)
    WHERE request_id IS NOT NULL
  `;
  },
);
