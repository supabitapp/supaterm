import * as Migrator from "effect/sql/Migrator";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import Migration0001 from "./Migrations/001_Baseline.ts";
import { ensurePushNotificationsSchema } from "./pushNotificationsSchema.ts";

/**
 * Add a schema change as a new entry with the next id. Never edit, renumber, or
 * remove a shipped entry: the migrator skips every id up to the highest one a
 * database recorded.
 */
const migrationEntries = [[1, "Baseline", Migration0001]] as const;

export const migrationManifest = migrationEntries.map(([id, name]) => [id, name] as const);

const loader = Migrator.fromRecord(
  Object.fromEntries(
    migrationEntries.map(([id, name, migration]) => [`${id}_${name}`, migration] as const),
  ),
);

/**
 * The migrator compares ids only, so it would silently skip any of this
 * build's migrations at or below the highest recorded id that the ledger holds
 * under another name. Refuse that. Recorded ids this build does not know, such
 * as those a newer Supaterm added, are left in place so older builds keep
 * opening the database.
 */
const assertKnownMigrationHistory = Effect.fn("assertKnownMigrationHistory")(function* () {
  const sql = yield* SqlClient.SqlClient;
  const tables = yield* sql`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'effect_sql_migrations'
  `;
  if (tables.length === 0) return;
  const recorded = yield* sql<{
    readonly migration_id: number;
    readonly name: string;
  }>`SELECT migration_id, name FROM effect_sql_migrations`;
  const latestRecordedId = Math.max(0, ...recorded.map((row) => row.migration_id));
  const recordedNames = new Map(recorded.map((row) => [row.migration_id, row.name]));
  const skipped = migrationManifest.flatMap(([id, name]) => {
    if (id > latestRecordedId) return [];
    const recordedName = recordedNames.get(id);
    if (recordedName === name) return [];
    return [`${id}_${name} (recorded: ${recordedName ?? "nothing"})`];
  });
  if (skipped.length > 0) {
    return yield* new Migrator.MigrationError({
      kind: "BadState",
      message: `This database was created by a build with a different migration history (${skipped.join(", ")}). Move it aside and restart to create a new one.`,
    });
  }
  const knownNames = new Map<number, string>(migrationManifest);
  const unknown = recorded
    .filter((row) => knownNames.get(row.migration_id) !== row.name)
    .map((row) => `${row.migration_id}_${row.name}`);
  if (unknown.length > 0) {
    yield* Effect.logWarning(
      "This database has migrations this build does not know, probably from a newer Supaterm; leaving them in place",
    ).pipe(Effect.annotateLogs({ migrations: unknown }));
  }
});

/**
 * Additive schema that older builds tolerate. It stays out of the migration
 * ledger because earlier releases refuse to open a database that recorded a
 * migration they do not know.
 */
const ensureUnrecordedSchema = Effect.fn("ensureUnrecordedSchema")(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE INDEX IF NOT EXISTS orchestration_v2_provider_turns_codex_native_id_idx
    ON orchestration_v2_projection_provider_turns (
      json_extract(payload_json, '$.nativeTurnRef.nativeId')
    )
    WHERE json_extract(payload_json, '$.nativeTurnRef.driver') = 'codex'
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS orchestration_v2_projection_turn_items_failed_error_idx
    ON orchestration_v2_projection_turn_items(
      thread_id, run_id, node_id, updated_at DESC, ordinal DESC, turn_item_id DESC
    )
    WHERE type = 'error' AND status = 'failed'
  `;
  yield* ensurePushNotificationsSchema();
});

const run = Migrator.make({});

/**
 * Run all pending migrations, then create the schema kept out of the ledger.
 *
 * Creates the migrations tracking table (effect_sql_migrations) if it doesn't exist,
 * then runs any migrations with ID greater than the latest recorded migration.
 *
 * Returns array of [id, name] tuples for migrations that were run.
 */
export const runMigrations = Effect.fn("runMigrations")(function* () {
  yield* assertKnownMigrationHistory();
  const executedMigrations = yield* run({ loader });
  const migrations = executedMigrations.map(([id, name]) => `${id}_${name}`);
  yield* migrations.length === 0
    ? Effect.logDebug("Database schema is current")
    : Effect.log("Migrations ran successfully").pipe(Effect.annotateLogs({ migrations }));
  yield* ensureUnrecordedSchema();
  return executedMigrations;
});
