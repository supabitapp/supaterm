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

  it.effect(
    "indexes shell resume and stop-request lookups without changing recorded migrations",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations();
        const changes = yield* sql<{ readonly detail: string }>`
        EXPLAIN QUERY PLAN SELECT aggregate_kind, stream_id, MAX(sequence)
        FROM orchestration_events INDEXED BY idx_orchestration_events_sequence_aggregate
        WHERE sequence > 1 AND sequence <= 9
        GROUP BY aggregate_kind, stream_id
      `;
        assert.isTrue(
          changes.some((row) =>
            row.detail.includes("USING COVERING INDEX idx_orchestration_events_sequence_aggregate"),
          ),
        );
        const interrupt = yield* sql<{ readonly detail: string }>`
        EXPLAIN QUERY PLAN SELECT 1 FROM orchestration_v2_projection_turn_items request
        WHERE request.thread_id = 'thread' AND request.run_id = 'run'
          AND request.type = 'run_interrupt_request'
      `;
        assert.isTrue(
          interrupt.some((row) =>
            row.detail.includes("orchestration_v2_projection_turn_items_run_interrupt_idx"),
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
});
