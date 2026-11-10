import * as HostProcess from "@supaterm/shared/HostProcess";
import * as NodeSqliteClient from "@supaterm/shared/nodeSqliteClient";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- Effect has no free-space query.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as SqlClient from "effect/sql/SqlClient";
import { isSqlError } from "effect/sql/SqlError";

import * as EventStore from "../orchestration-v2/EventStore.ts";
import * as ProjectionMaintenance from "../orchestration-v2/ProjectionMaintenance.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import { rebuildMessageSearch } from "../orchestration-v2/messageSearchIndex.ts";

export class DatabaseMissingError extends Schema.TaggedError<DatabaseMissingError>()(
  "DatabaseMissingError",
  { path: Schema.String },
) {
  override get message() {
    return "No existing Supaterm database was found in this data directory.";
  }
}

export class DatabaseInUseError extends Schema.TaggedError<DatabaseInUseError>()(
  "DatabaseInUseError",
  { path: Schema.String, cause: Schema.Defect() },
) {
  override get message() {
    return "Stop the Supaterm server and desktop app before compacting the database.";
  }
}

export class DatabaseProjectionsInvalidError extends Schema.TaggedError<DatabaseProjectionsInvalidError>()(
  "DatabaseProjectionsInvalidError",
  { path: Schema.String },
) {
  override get message() {
    return "Database projections need repair before compaction. Start Supaterm once so it rebuilds them, then run doctor again. If this CLI is older than the one that wrote the database, update Supaterm first.";
  }
}

export class DatabaseInspectError extends Schema.TaggedError<DatabaseInspectError>()(
  "DatabaseInspectError",
  { path: Schema.String, cause: Schema.Defect() },
) {
  override get message() {
    return "Could not read the database. Check that this user can open it.";
  }
}

export class DatabaseCompactError extends Schema.TaggedError<DatabaseCompactError>()(
  "DatabaseCompactError",
  { path: Schema.String, cause: Schema.Defect() },
) {
  override get message() {
    return "Database compaction failed. Check that no other process has the database open and enough disk space is available.";
  }
}

export class DiskSpaceCheckError extends Schema.TaggedError<DiskSpaceCheckError>()(
  "DiskSpaceCheckError",
  { path: Schema.String, cause: Schema.Defect() },
) {
  override get message() {
    return "Could not check free disk space.";
  }
}

/** Offline inspection and repair of a Supaterm state database, for `supaterm doctor`. */
export class DatabaseMaintenance extends Context.Service<
  DatabaseMaintenance,
  {
    readonly inspect: (databasePath: string) => Effect.Effect<
      {
        readonly databaseBytes: number;
        readonly reclaimableBytes: number;
        readonly incrementalVacuumEnabled: boolean;
      },
      DatabaseMissingError | DatabaseInspectError
    >;
    /** Compacts history, then VACUUMs into incremental auto_vacuum. Refuses while a server has it open. */
    readonly compact: (databasePath: string) => Effect.Effect<
      {
        readonly beforeBytes: number;
        readonly afterBytes: number;
        readonly deletedEventCount: number;
      },
      | DatabaseMissingError
      | DatabaseInUseError
      | DatabaseProjectionsInvalidError
      | DatabaseCompactError
    >;
  }
>()("supaterm/persistence/DatabaseMaintenance") {}

const isDomainError = Schema.is(
  Schema.Union([DatabaseMissingError, DatabaseInUseError, DatabaseProjectionsInvalidError]),
);

const readStorage = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const pages = yield* sql<{ readonly page_count: number }>`PRAGMA page_count`;
  const free = yield* sql<{ readonly freelist_count: number }>`PRAGMA freelist_count`;
  const size = yield* sql<{ readonly page_size: number }>`PRAGMA page_size`;
  const mode = yield* sql<{ readonly auto_vacuum: number }>`PRAGMA auto_vacuum`;
  const pageSize = size[0]?.page_size ?? 0;
  return {
    databaseBytes: (pages[0]?.page_count ?? 0) * pageSize,
    reclaimableBytes: (free[0]?.freelist_count ?? 0) * pageSize,
    incrementalVacuumEnabled: mode[0]?.auto_vacuum === 2,
  };
});

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;

  const locate = Effect.fn("DatabaseMaintenance.locate")(function* (databasePath: string) {
    if (!(yield* fs.exists(databasePath))) {
      return yield* new DatabaseMissingError({ path: databasePath });
    }
  });

  const inspect = Effect.fn("DatabaseMaintenance.inspect")(
    function* (databasePath: string) {
      yield* locate(databasePath);
      return yield* readStorage.pipe(
        Effect.provide(NodeSqliteClient.layer({ filename: databasePath, readonly: true })),
      );
    },
    (effect, databasePath) =>
      effect.pipe(
        Effect.mapError((cause) =>
          isDomainError(cause) ? cause : new DatabaseInspectError({ path: databasePath, cause }),
        ),
      ),
  );

  const compact = Effect.fn("DatabaseMaintenance.compact")(
    function* (databasePath: string) {
      yield* locate(databasePath);
      const beforeBytes = Number((yield* fs.stat(databasePath)).size);
      const result = yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        // Hold an exclusive lock through compaction and VACUUM. In WAL mode this
        // is refused while any other connection has the file open, even an idle
        // one, which is how a running server or desktop app is detected.
        yield* sql`PRAGMA busy_timeout = 0`;
        // VACUUM and the truncating checkpoint sync through checkpoints, which
        // need F_FULLFSYNC on macOS to reach the disk.
        yield* sql`PRAGMA checkpoint_fullfsync = ON`;
        yield* sql`PRAGMA locking_mode = EXCLUSIVE`;
        yield* sql`BEGIN EXCLUSIVE`.pipe(
          Effect.mapError((cause) =>
            isSqlError(cause) && cause.reason._tag === "LockTimeoutError"
              ? new DatabaseInUseError({ path: databasePath, cause })
              : cause,
          ),
        );
        yield* sql`COMMIT`;
        const maintenance = yield* ProjectionMaintenance.ProjectionMaintenanceV2;
        if (!(yield* maintenance.verify).valid) {
          return yield* new DatabaseProjectionsInvalidError({ path: databasePath });
        }
        const summary = yield* maintenance.compactEventStore();
        if (!(yield* maintenance.verify).valid) {
          return yield* new DatabaseProjectionsInvalidError({ path: databasePath });
        }
        // VACUUM rebuilds the file, which is the only way to switch an existing
        // database to incremental auto_vacuum; the server reclaims online after.
        yield* sql`PRAGMA auto_vacuum = INCREMENTAL`;
        yield* sql`VACUUM`;
        yield* rebuildMessageSearch(sql);
        yield* sql`PRAGMA wal_checkpoint(TRUNCATE)`;
        return summary;
      }).pipe(
        Effect.provide(
          ProjectionMaintenance.layer.pipe(
            Layer.provide(Layer.merge(EventStore.layer, ProjectionStore.layer)),
            Layer.provideMerge(NodeSqliteClient.layer({ filename: databasePath })),
          ),
        ),
      );
      const afterBytes = Number((yield* fs.stat(databasePath)).size);
      return {
        beforeBytes,
        afterBytes,
        deletedEventCount: result.deletedEventCount,
      };
    },
    (effect, databasePath) =>
      effect.pipe(
        Effect.mapError((cause) =>
          isDomainError(cause) ? cause : new DatabaseCompactError({ path: databasePath, cause }),
        ),
      ),
  );

  return DatabaseMaintenance.of({ inspect, compact });
});

export const layer = Layer.effect(DatabaseMaintenance, make);

/** Settings' Reclaim writes the request; the failure stays for Settings until the next request. */
export const reclaimFiles = (path: Path.Path, databasePath: string) => ({
  request: path.join(path.dirname(databasePath), "reclaim-requested"),
  failure: path.join(path.dirname(databasePath), "reclaim-failed"),
});

/** Runs a repair that Settings requested. The server calls this on exit, once its database is closed. */
export const runRequestedReclaim = Effect.fn("DatabaseMaintenance.runRequestedReclaim")(
  function* (databasePath: string) {
    const fs = yield* FileSystem.FileSystem;
    const files = reclaimFiles(yield* Path.Path, databasePath);
    if (!(yield* fs.exists(files.request))) return;
    // One attempt per request, so a repair killed midway (it rolls back) cannot delay later exits.
    yield* fs.remove(files.request, { force: true });
    yield* Effect.logInfo("Reclaiming database space before the restart. This can take minutes.");
    const maintenance = yield* DatabaseMaintenance;
    yield* maintenance.compact(databasePath).pipe(
      // Worker threads and agent processes can hold the file for a moment after the server stops.
      Effect.retry({
        times: 10,
        while: (error) => error._tag === "DatabaseInUseError",
        schedule: Schedule.spaced("1 second"),
      }),
      Effect.matchEffect({
        onSuccess: (result) =>
          fs
            .remove(files.failure, { force: true })
            .pipe(Effect.andThen(Effect.logInfo("Reclaimed database space", result))),
        onFailure: (error) =>
          fs
            .writeFileString(
              files.failure,
              error._tag === "DatabaseInUseError"
                ? "Another program kept the database open. Close other Supaterm apps and supaterm commands on this machine, then try again."
                : error.message,
            )
            .pipe(
              Effect.andThen(Effect.logWarning("Database space reclamation failed", { error })),
            ),
      }),
    );
  },
  Effect.catchCause((cause) => Effect.logWarning("Database space reclamation failed", { cause })),
);

// SQLite's search order for its temporary files (unixTempFileDir in os_unix.c).
const sqliteTempDirectory = Effect.gen(function* () {
  if ((yield* HostProcess.Platform) === "win32") return NodeOS.tmpdir();
  const fs = yield* FileSystem.FileSystem;
  const env = yield* HostProcess.Environment;
  for (const directory of [env.SQLITE_TMPDIR, env.TMPDIR, "/var/tmp", "/usr/tmp", "/tmp"]) {
    if (directory === undefined || directory === "") continue;
    const info = yield* fs.stat(directory).pipe(Effect.option);
    if (Option.isNone(info) || info.value.type !== "Directory") continue;
    // SQLite skips directories it cannot write to and search: osAccess(zDir, 03).
    const usable = yield* Effect.tryPromise({
      try: () => NodeFSP.access(directory, NodeFSP.constants.W_OK | NodeFSP.constants.X_OK),
      catch: (cause) => new DiskSpaceCheckError({ path: directory, cause }),
    }).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    );
    if (usable) return directory;
  }
  return ".";
});

const freeBytes = (directory: string) =>
  Effect.tryPromise({
    try: () => NodeFSP.statfs(directory),
    catch: (cause) => new DiskSpaceCheckError({ path: directory, cause }),
  }).pipe(Effect.map((stats) => stats.bavail * stats.bsize));

/**
 * VACUUM copies the live pages to a temporary file, then writes them again to the WAL.
 * Returns the free space the repair needs when either file system has less, else null.
 */
export const reclaimSpaceShortfall = Effect.fn("DatabaseMaintenance.reclaimSpaceShortfall")(
  function* (databasePath: string, liveBytes: number) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const databaseDirectory = path.dirname(databasePath);
    const tempDirectory = yield* sqliteTempDirectory;
    const copyBytes = Math.ceil(liveBytes * 1.1);
    const [databaseFree, tempFree, databaseDevice, tempDevice] = yield* Effect.all([
      freeBytes(databaseDirectory),
      freeBytes(tempDirectory),
      fs.stat(databaseDirectory).pipe(Effect.map((info) => info.dev)),
      fs.stat(tempDirectory).pipe(Effect.map((info) => info.dev)),
    ]);
    if (databaseDevice === tempDevice) {
      return databaseFree < 2 * copyBytes
        ? { neededBytes: 2 * copyBytes, freeBytes: databaseFree }
        : null;
    }
    if (databaseFree < copyBytes) return { neededBytes: copyBytes, freeBytes: databaseFree };
    return tempFree < copyBytes ? { neededBytes: copyBytes, freeBytes: tempFree } : null;
  },
);
