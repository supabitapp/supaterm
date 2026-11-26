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

import * as ProjectionMaintenance from "../orchestration-v2/ProjectionMaintenance.ts";
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
  {
    path: Schema.String,
    cause: Schema.Defect(),
    pid: Schema.optional(Schema.Int),
    serviceManaged: Schema.optional(Schema.Boolean),
  },
) {
  override get message() {
    if (this.pid !== undefined) {
      return `Stop Supaterm server process ${this.pid}${this.serviceManaged ? "" : ", which the background service did not start,"} before compacting the database.`;
    }
    return "Stop the Supaterm server and desktop app before compacting the database.";
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

export class DatabaseBackupSpaceError extends Schema.TaggedError<DatabaseBackupSpaceError>()(
  "DatabaseBackupSpaceError",
  { path: Schema.String, neededBytes: Schema.Number, freeBytes: Schema.Number },
) {
  override get message() {
    return `Backing up the database before its first prune needs ${formatGiB(this.neededBytes)} of free disk space beside it. ${formatGiB(this.freeBytes)} is free.`;
  }
}

export type DatabaseCompactStep =
  | "compact-events"
  | "back-up"
  | "prune-events"
  | "vacuum"
  | "rebuild-search"
  | "checkpoint";

/** Superseded events only, or every event the projections cover once it is a day old. */
export type HistoryRemoval = "compact" | "prune";

/** Rewrite the file every time, or only when removing history deleted events. */
export type DatabaseRewrite = "always" | "when-deleted";

const formatGiB = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GiB`;

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
    /**
     * Compacts history, then VACUUMs into incremental auto_vacuum. Refuses while a server has it open.
     * Calls `onStep` as each step starts; VACUUM time grows with the whole database size.
     */
    readonly compact: (
      databasePath: string,
      options?: {
        readonly history?: HistoryRemoval;
        readonly vacuum?: DatabaseRewrite;
        readonly onStep?: (step: DatabaseCompactStep) => Effect.Effect<void>;
      },
    ) => Effect.Effect<
      {
        readonly beforeBytes: number;
        readonly afterBytes: number;
        readonly deletedEventCount: number;
        /** Where pruning stood when the repair started; null when it only compacted. */
        readonly pruneSchedule: ProjectionMaintenance.EventLogPruneSchedule | null;
      },
      DatabaseMissingError | DatabaseInUseError | DatabaseCompactError
    >;
    /** What pruning would delete now and where its first backup goes. Opens read-only. */
    readonly previewPrune: (databasePath: string) => Effect.Effect<
      {
        readonly schedule: ProjectionMaintenance.EventLogPruneSchedule;
        readonly prunableEventCount: number;
        readonly eventCount: number;
        readonly backup: {
          readonly path: string;
          readonly neededBytes: number;
          readonly freeBytes: number;
        } | null;
      },
      DatabaseMissingError | DatabaseInspectError
    >;
  }
>()("supaterm/persistence/DatabaseMaintenance") {}

const isDomainError = Schema.is(Schema.Union([DatabaseMissingError, DatabaseInUseError]));

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
  const path = yield* Path.Path;

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
    function* (
      databasePath: string,
      options: {
        readonly history?: HistoryRemoval;
        readonly vacuum?: DatabaseRewrite;
        readonly onStep?: (step: DatabaseCompactStep) => Effect.Effect<void>;
      } = {},
    ) {
      const onStep = options.onStep ?? (() => Effect.void);
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
        const summary =
          options.history === "prune"
            ? yield* onStep("prune-events").pipe(
                Effect.andThen(
                  maintenance.pruneEventStore({
                    backUp: onStep("back-up").pipe(
                      Effect.andThen(backUpBeforePruning(databasePath)),
                      Effect.provideService(SqlClient.SqlClient, sql),
                      Effect.provideService(FileSystem.FileSystem, fs),
                      Effect.provideService(Path.Path, path),
                    ),
                  }),
                ),
              )
            : yield* onStep("compact-events").pipe(
                Effect.andThen(maintenance.compactEventStore()),
                Effect.map((compacted) => ({ ...compacted, schedule: null })),
              );
        if (options.vacuum !== "when-deleted" || summary.deletedEventCount > 0) {
          yield* onStep("vacuum");
          // VACUUM rebuilds the file, which is the only way to switch an existing
          // database to incremental auto_vacuum; the server reclaims online after.
          yield* sql`PRAGMA auto_vacuum = INCREMENTAL`;
          yield* sql`VACUUM`;
          yield* onStep("rebuild-search");
          yield* rebuildMessageSearch(sql);
        }
        yield* onStep("checkpoint");
        yield* sql`PRAGMA wal_checkpoint(TRUNCATE)`;
        return summary;
      }).pipe(
        Effect.provide(
          ProjectionMaintenance.layer.pipe(
            Layer.provideMerge(NodeSqliteClient.layer({ filename: databasePath })),
          ),
        ),
      );
      const afterBytes = Number((yield* fs.stat(databasePath)).size);
      return {
        beforeBytes,
        afterBytes,
        deletedEventCount: result.deletedEventCount,
        pruneSchedule: result.schedule,
      };
    },
    (effect, databasePath) =>
      effect.pipe(
        Effect.mapError((cause) =>
          isDomainError(cause) ? cause : new DatabaseCompactError({ path: databasePath, cause }),
        ),
      ),
  );

  const previewPrune = Effect.fn("DatabaseMaintenance.previewPrune")(
    function* (databasePath: string) {
      yield* locate(databasePath);
      return yield* Effect.gen(function* () {
        const maintenance = yield* ProjectionMaintenance.ProjectionMaintenanceV2;
        const preview = yield* maintenance.previewEventStorePrune;
        const backup = preview.backupNeeded ? yield* planPruneBackup(fs, path, databasePath) : null;
        return {
          schedule: preview.schedule,
          prunableEventCount: preview.prunableEventCount,
          eventCount: preview.eventCount,
          backup,
        };
      }).pipe(
        Effect.provide(
          ProjectionMaintenance.layer.pipe(
            Layer.provideMerge(NodeSqliteClient.layer({ filename: databasePath, readonly: true })),
          ),
        ),
      );
    },
    (effect, databasePath) =>
      effect.pipe(
        Effect.mapError((cause) =>
          isDomainError(cause) ? cause : new DatabaseInspectError({ path: databasePath, cause }),
        ),
      ),
  );

  return DatabaseMaintenance.of({ inspect, compact, previewPrune });
});

export const layer = Layer.effect(DatabaseMaintenance, make);

/** The copy taken before the first prune deletes anything. Restoring it brings back the whole log. */
export const pruneBackupPath = (path: Path.Path, databasePath: string, copy = 1) => {
  const extension = path.extname(databasePath);
  return path.join(
    path.dirname(databasePath),
    `${path.basename(databasePath, extension)}-before-pruning${copy === 1 ? "" : `-${copy}`}${extension}`,
  );
};

/** An earlier database at this path may have left its copy, which a new one must not replace. */
const planPruneBackup = Effect.fnUntraced(function* (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  databasePath: string,
) {
  let copy = 1;
  while (yield* fs.exists(pruneBackupPath(path, databasePath, copy))) copy++;
  const target = pruneBackupPath(path, databasePath, copy);
  const storage = yield* readStorage;
  return {
    path: target,
    neededBytes: Math.ceil((storage.databaseBytes - storage.reclaimableBytes) * 1.1),
    freeBytes: yield* freeBytes(path.dirname(target)),
  };
});

/**
 * Copies the database beside itself with VACUUM INTO on the reader, then syncs and renames the
 * copy into place. ProjectionMaintenance runs it before the first pass that deletes events.
 */
export const backUpBeforePruning = Effect.fn("DatabaseMaintenance.backUpBeforePruning")(function* (
  databasePath: string,
) {
  const sql = yield* SqlClient.SqlClient;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const backup = yield* planPruneBackup(fs, path, databasePath);
  // The copy shares a disk with the live database; filling it would fail the server's writes.
  if (backup.freeBytes < backup.neededBytes) return yield* new DatabaseBackupSpaceError(backup);
  const target = backup.path;
  const partial = `${target}.partial`;
  yield* fs.remove(partial, { force: true });
  yield* Effect.gen(function* () {
    yield* sql`VACUUM INTO ${partial}`.pipe(NodeSqliteClient.readOnly);
    // VACUUM INTO creates the copy with the umask; it holds everything the database does.
    yield* fs.chmod(partial, 0o600);
    yield* Effect.scoped(Effect.flatMap(fs.open(partial, { flag: "r+" }), (file) => file.sync));
    yield* fs.rename(partial, target);
  }).pipe(Effect.onError(() => fs.remove(partial, { force: true }).pipe(Effect.ignore)));
  // Best effort: Windows cannot open a directory to sync the rename.
  yield* Effect.scoped(
    Effect.flatMap(fs.open(path.dirname(target), { flag: "r" }), (directory) => directory.sync),
  ).pipe(Effect.ignore);
  yield* Effect.logInfo("Backed up the database before its first prune", { path: target });
});

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
