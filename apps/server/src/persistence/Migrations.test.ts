import { assert, describe, it } from "@effect/vitest";
import * as NodeSqliteClient from "@supaterm/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as SqlClient from "effect/sql/SqlClient";

import { migrationManifest, runMigrations } from "./Migrations.ts";

const createLedger = (rows: ReadonlyArray<readonly [number, string]>) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      CREATE TABLE effect_sql_migrations (
        migration_id INTEGER PRIMARY KEY NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        name VARCHAR(255) NOT NULL
      )
    `;
    for (const [id, name] of rows) {
      yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (${id}, ${name})`;
    }
  });

const failedErrorIndex = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  return yield* sql<{ readonly name: string }>`
    SELECT name FROM sqlite_master
    WHERE type = 'index' AND name = 'orchestration_v2_projection_turn_items_failed_error_idx'
  `;
});

const history = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ readonly migration_id: number; readonly name: string }>`
    SELECT migration_id, name FROM effect_sql_migrations ORDER BY migration_id
  `;
  return rows.map((row) => [row.migration_id, row.name] as const);
});

describe("runMigrations", () => {
  it.effect("creates a fresh database from the whole manifest once", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      assert.deepStrictEqual(yield* runMigrations(), migrationManifest);
      assert.deepStrictEqual(yield* history, migrationManifest);
      assert.lengthOf(yield* failedErrorIndex, 1);
      assert.deepStrictEqual(yield* runMigrations(), []);
      const metadata = yield* sql<{ readonly last_sequence: number }>`
        SELECT last_sequence FROM orchestration_v2_projection_metadata
        WHERE projection_name = 'thread-projections'
      `;
      assert.deepStrictEqual(metadata, [{ last_sequence: 0 }]);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("indexes native usage lookup without changing recorded migrations", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations();
      const plan = yield* sql<{ readonly detail: string }>`
        EXPLAIN QUERY PLAN SELECT provider_turn_id
        FROM orchestration_v2_projection_provider_turns
        WHERE json_extract(payload_json, '$.nativeTurnRef.driver') = 'codex'
          AND json_extract(payload_json, '$.nativeTurnRef.nativeId') IN ('native-turn')
      `;
      assert.isTrue(
        plan.some((row) =>
          row.detail.includes("USING INDEX orchestration_v2_provider_turns_codex_native_id_idx"),
        ),
      );
      assert.deepStrictEqual(yield* runMigrations(), []);
      assert.deepStrictEqual(yield* history, migrationManifest);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("refuses a database whose migration history came from another build", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* createLedger([
        [1, "OrchestrationEvents"],
        [60, "PullRequestReviewGuides"],
      ]);

      const exit = yield* Effect.exit(runMigrations());

      assert.isTrue(Exit.isFailure(exit));
      assert.include(String(exit), "1_Baseline (recorded: OrchestrationEvents)");
      const tables = yield* sql`
        SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'orchestration_events'
      `;
      assert.strictEqual(tables.length, 0);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("refuses a history that would skip one of this build's migrations", () =>
    Effect.gen(function* () {
      yield* createLedger([[2, "SomeOtherBuild"]]);

      const exit = yield* Effect.exit(runMigrations());

      assert.isTrue(Exit.isFailure(exit));
      assert.include(String(exit), "1_Baseline (recorded: nothing)");
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("opens a database a newer Supaterm migrated past this build", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations();
      const newer = [
        [2, "ThreadFailureLookupIndex"],
        [3, "FromANewerBuild"],
      ] as const;
      for (const [id, name] of newer) {
        yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (${id}, ${name})`;
      }

      assert.deepStrictEqual(yield* runMigrations(), []);
      assert.deepStrictEqual(yield* history, [...migrationManifest, ...newer]);
      assert.lengthOf(yield* failedErrorIndex, 1);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("adds push columns to tables an earlier push schema created", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`
        CREATE TABLE push_registrations (
          registration_id TEXT PRIMARY KEY, session_id TEXT NOT NULL,
          gateway_origin TEXT NOT NULL, handle TEXT NOT NULL, key_id TEXT NOT NULL,
          recipient_public_key TEXT NOT NULL, preview TEXT NOT NULL, kinds_json TEXT NOT NULL,
          device_name TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL, last_delivery_at TEXT
        )
      `;
      yield* sql`
        INSERT INTO push_registrations VALUES (
          'registration', 'session', 'https://push.supaterm.com', 'handle', 'key', 'public',
          'titles', '{}', NULL, 'active', '2026-10-21T00:00:00.000Z',
          '2026-10-21T00:00:00.000Z', NULL
        )
      `;
      yield* sql`
        CREATE TABLE push_deliveries (
          delivery_id INTEGER PRIMARY KEY AUTOINCREMENT, registration_id TEXT NOT NULL,
          thread_id TEXT NOT NULL, attention_key TEXT NOT NULL, kind TEXT NOT NULL,
          occurred_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, status TEXT NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL,
          lease_until INTEGER, envelope_json TEXT, envelope_expires_at INTEGER,
          notification_id TEXT NOT NULL, UNIQUE (registration_id, thread_id, attention_key)
        )
      `;
      yield* sql`
        CREATE TABLE push_thread_attention (
          thread_id TEXT PRIMARY KEY, attention_key TEXT, kind TEXT,
          updated_sequence INTEGER NOT NULL
        )
      `;

      yield* runMigrations();
      yield* runMigrations();
      const columns = (table: string) =>
        sql<{ readonly name: string }>`SELECT name FROM pragma_table_info(${table})`.pipe(
          Effect.map((rows) => rows.map((row) => row.name)),
        );
      assert.includeMembers(yield* columns("push_deliveries"), [
        "request_thread_id",
        "request_id",
        "envelope_revision",
      ]);
      assert.deepStrictEqual(yield* sql`SELECT registration_id, revision FROM push_registrations`, [
        { registration_id: "registration", revision: 0 },
      ]);
      assert.deepStrictEqual(yield* columns("push_thread_attention"), []);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
});
