import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as SqlError from "effect/sql/SqlError";
import * as NodeSqliteClient from "@supaterm/shared/nodeSqliteClient";

import { hasPendingMigrations, runMigrations } from "./Migrations.ts";
import * as ServerConfig from "../config.ts";
import * as ServerOwnership from "../serverOwnership.ts";

const WAL_SIZE_LIMIT_BYTES = 128 * 1024 * 1024;

export class ServerOwnsDatabaseError extends Schema.TaggedError<ServerOwnsDatabaseError>()(
  "ServerOwnsDatabaseError",
  { stateDir: Schema.String },
) {
  override get message(): string {
    return `Another Supaterm process, usually a running server, owns ${this.stateDir}, and this CLI would change its database schema. Use the \`supaterm\` that matches the running server, or stop that server, then retry. The database was not changed.`;
  }
}

const DAMAGED_SQLITE_CODES = new Set([11, 26]);

const isDamagedDatabase = (error: SqlError.SqlError): boolean => {
  const seen = new Set<unknown>();
  let cause: unknown = error.cause;
  while (Predicate.isObject(cause) && !seen.has(cause)) {
    seen.add(cause);
    if (typeof cause.errcode === "number" && DAMAGED_SQLITE_CODES.has(cause.errcode & 0xff)) {
      return true;
    }
    cause = cause.cause;
  }
  return false;
};

const damagedDatabaseError = (dbPath: string, cause: SqlError.SqlError) =>
  new SqlError.SqlError({
    reason: new SqlError.UnknownError({
      cause,
      operation: "open",
      message: `The Supaterm database at ${dbPath} is damaged or is not a SQLite database, so Supaterm cannot start. To recover, quit Supaterm, then move that file and any -wal and -shm files next to it out of the folder, or replace them with a backup. Supaterm creates a new database on the next start.`,
    }),
  });

const runMigrationsAsOwner = Effect.fn("SqlitePersistence.runMigrationsAsOwner")(function* () {
  if (!(yield* hasPendingMigrations())) return yield* runMigrations();
  const { serverRuntimeStatePath } = yield* ServerConfig.ServerConfig;
  yield* ServerOwnership.holdServerOwnershipLock(serverRuntimeStatePath).pipe(
    Effect.catchTags({
      ServerAlreadyRunningError: ({ stateDir }) =>
        Effect.fail(new ServerOwnsDatabaseError({ stateDir })),
    }),
  );
  yield* runMigrations();
}, Effect.scoped);

const makeLayerSetup = <E, R>(migrate: Effect.Effect<unknown, E, R>) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`PRAGMA busy_timeout = 5000;`;
      yield* sql`PRAGMA foreign_keys = ON;`;
      const tables = yield* sql<{
        readonly count: number;
      }>`SELECT COUNT(*) AS count FROM sqlite_schema WHERE type = 'table'`;
      if (tables[0]?.count === 0) yield* sql`PRAGMA auto_vacuum = INCREMENTAL;`;
      yield* sql`PRAGMA journal_mode = WAL;`;
      yield* sql`PRAGMA synchronous = NORMAL;`;
      yield* sql`PRAGMA checkpoint_fullfsync = ON;`;
      yield* sql`PRAGMA temp_store = MEMORY;`;
      yield* sql.unsafe(`PRAGMA journal_size_limit = ${WAL_SIZE_LIMIT_BYTES};`);
      yield* migrate;
      const statTables = yield* sql`SELECT 1 FROM sqlite_schema WHERE name = 'sqlite_stat1'`;
      if (statTables.length > 0) {
        yield* sql`DELETE FROM sqlite_stat1;`;
        yield* sql`ANALYZE sqlite_schema;`;
      }
    }).pipe(Effect.withSpan("Sqlite.setup")),
  );

const layerSetup = makeLayerSetup(runMigrations());

const makeLayerFromPath = <E, R>(setup: Layer.Layer<never, E, R>) =>
  Effect.fn("makeSqlitePersistenceLive")(function* (dbPath: string) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* fs.makeDirectory(path.dirname(dbPath), { recursive: true });

    return Layer.provideMerge(
      setup,
      NodeSqliteClient.layer({
        filename: dbPath,
        readerWorker: true,
        writerWorker: true,
        spanAttributes: {
          "db.name": path.basename(dbPath),
          "service.name": "supaterm-server",
        },
      }),
    ).pipe(
      Layer.catchTag("SqlError", (error) =>
        Layer.effect(
          SqlClient.SqlClient,
          Effect.fail(
            SqlError.isSqlError(error) && isDamagedDatabase(error)
              ? damagedDatabaseError(dbPath, error)
              : error,
          ),
        ),
      ),
    );
  }, Layer.unwrap);

export const layerFromPath = makeLayerFromPath(layerSetup);

export const layerMemory = Layer.provideMerge(
  layerSetup,
  NodeSqliteClient.layer({ filename: ":memory:" }),
);

const makeLayerConfig = <E, R>(
  fromPath: (dbPath: string) => Layer.Layer<SqlClient.SqlClient, E, R>,
) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const { dbPath } = yield* ServerConfig.ServerConfig;
      return fromPath(dbPath);
    }),
  );

export const layerConfig = makeLayerConfig(layerFromPath);

/** For CLI commands: pending migrations run only while no server owns the Supaterm home. */
export const layerCliConfig = makeLayerConfig(
  makeLayerFromPath(makeLayerSetup(runMigrationsAsOwner())),
);
