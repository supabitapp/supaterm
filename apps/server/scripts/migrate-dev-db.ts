#!/usr/bin/env node

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeOS from "node:os";
import * as NodeURL from "node:url";
import { resolveWorktreeSupatermHome } from "@supaterm/shared/devHome";
import { resolveDefaultSupatermHome } from "@supaterm/shared/supatermHome";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import { Command, Flag } from "effect/cli";

import * as ProjectionStore from "../src/orchestration-v2/ProjectionStore.ts";
import { rebuildMessageSearch } from "../src/orchestration-v2/messageSearchIndex.ts";
import { runMigrations } from "../src/persistence/Migrations.ts";
import * as HostProcess from "@supaterm/shared/HostProcess";
import * as NodeSqliteClient from "@supaterm/shared/nodeSqliteClient";

export class MigrateDevDbNotInWorktreeError extends Schema.TaggedError<MigrateDevDbNotInWorktreeError>()(
  "MigrateDevDbNotInWorktreeError",
  {},
) {
  override get message(): string {
    return "Not inside a linked git worktree. Pass --base-dir to target an isolated .supaterm directory.";
  }
}

export class MigrateDevDbSharedHomeError extends Schema.TaggedError<MigrateDevDbSharedHomeError>()(
  "MigrateDevDbSharedHomeError",
  {},
) {
  override get message(): string {
    return "Refusing to rebuild the shared ~/.supaterm database. Use an isolated --base-dir.";
  }
}

export class MigrateDevDbSourceMissingError extends Schema.TaggedError<MigrateDevDbSourceMissingError>()(
  "MigrateDevDbSourceMissingError",
  {
    sourcePath: Schema.String,
  },
) {
  override get message(): string {
    return `Source database does not exist at '${this.sourcePath}'.`;
  }
}

export class MigrateDevDbSourceIsDestinationError extends Schema.TaggedError<MigrateDevDbSourceIsDestinationError>()(
  "MigrateDevDbSourceIsDestinationError",
  {
    sourcePath: Schema.String,
  },
) {
  override get message(): string {
    return `Source database '${this.sourcePath}' resolves to a path this command rewrites. Pick a different --source or --base-dir.`;
  }
}

export class MigrateDevDbServerRunningError extends Schema.TaggedError<MigrateDevDbServerRunningError>()(
  "MigrateDevDbServerRunningError",
  {
    databasePath: Schema.String,
    pid: Schema.Number,
  },
) {
  override get message(): string {
    return `Dev database at '${this.databasePath}' is open by a running server (pid ${this.pid} per server-runtime.json). Stop that server first; if that pid is not actually a Supaterm server (stale descriptor, reused pid), delete the server-runtime.json next to the database and retry.`;
  }
}

export class MigrateDevDbDestinationBusyError extends Schema.TaggedError<MigrateDevDbDestinationBusyError>()(
  "MigrateDevDbDestinationBusyError",
  {
    databasePath: Schema.String,
    reason: Schema.Literals(["write-locked", "wal-held"]),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    const detail =
      this.reason === "write-locked"
        ? "the database is write-locked"
        : "another connection is holding its WAL";
    return `Dev database at '${this.databasePath}' looks in use (${detail}). Stop the dev server first; if none is running, delete the -wal/-shm files next to it.`;
  }
}

export class MigrateDevDbPhaseError extends Schema.TaggedError<MigrateDevDbPhaseError>()(
  "MigrateDevDbPhaseError",
  {
    phase: Schema.Literals(["snapshot", "prune", "compact"]),
    databasePath: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `migrate-dev-db failed during ${this.phase} on '${this.databasePath}'.`;
  }
}

export interface RunMigrateDevDbInput {
  readonly baseDir?: string | undefined;
  readonly source?: string | undefined;
  readonly projects: number;
  readonly threadsPerProject: number;
}

export interface RunMigrateDevDbOptions {
  /** Overridable for tests; the directory writes must never target. */
  readonly sharedHome?: string | undefined;
}

interface KeptProject {
  readonly title: string;
  readonly threads: number;
}

const removeDatabaseFiles = Effect.fn("removeDatabaseFiles")(function* (databasePath: string) {
  const fs = yield* FileSystem.FileSystem;
  for (const suffix of ["", "-wal", "-shm"]) {
    yield* fs.remove(`${databasePath}${suffix}`).pipe(Effect.orElseSucceed(() => undefined));
  }
});

const ServerRuntimeState = Schema.fromJsonString(Schema.Struct({ pid: Schema.Number }));
const decodeServerRuntimeState = Schema.decodeEffect(ServerRuntimeState);

const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

/**
 * The server writes its pid to server-runtime.json next to the database, which also catches an idle server holding an open-but-inactive
 * connection. A leftover -shm alone is not a signal — read-only connections cannot clean it up on close.
 */
const ensureNotInUse = Effect.fn("ensureDevDbNotInUse")(function* (databasePath: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const runtimeStatePath = path.join(path.dirname(databasePath), "server-runtime.json");
  const runtimeState = yield* fs
    .readFileString(runtimeStatePath)
    .pipe(Effect.flatMap(decodeServerRuntimeState), Effect.option);
  if (Option.isSome(runtimeState) && isProcessAlive(runtimeState.value.pid)) {
    return yield* new MigrateDevDbServerRunningError({
      databasePath,
      pid: runtimeState.value.pid,
    });
  }

  if (!(yield* fs.exists(databasePath))) {
    return;
  }
  const checkpoint = yield* Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql.unsafe("PRAGMA busy_timeout = 0").unprepared;
    yield* sql.unsafe("BEGIN IMMEDIATE").unprepared;
    yield* sql.unsafe("ROLLBACK").unprepared;
    return yield* sql.unsafe<{ busy: number }>("PRAGMA wal_checkpoint(TRUNCATE)").unprepared;
  }).pipe(
    Effect.provide(NodeSqliteClient.layer({ filename: databasePath })),
    Effect.mapError(
      (cause) =>
        new MigrateDevDbDestinationBusyError({
          databasePath,
          reason: "write-locked",
          cause,
        }),
    ),
  );
  if (checkpoint[0] !== undefined && Number(checkpoint[0].busy) !== 0) {
    return yield* new MigrateDevDbDestinationBusyError({
      databasePath,
      reason: "wal-held",
    });
  }
});

// Every kind startup recovery resumes, so a copied family never starts work by itself. The record
// fails typecheck when a kind is added and not listed here.
const RECOVERY_KIND_SET = {
  "queued-runs": true,
  runtime: true,
  "restart-continuations": true,
  "subagent-results": true,
  "delegated-completions": true,
  "unread-steers": true,
} satisfies Record<ProjectionStore.ProjectionRecoveryKind, true>;
const RECOVERY_KINDS = Object.keys(
  RECOVERY_KIND_SET,
) as ReadonlyArray<ProjectionStore.ProjectionRecoveryKind>;

const CLEARED_TABLES: ReadonlyArray<string> = [
  "scheduled_tasks",
  "orchestration_v2_effect_outbox",
  "orchestration_v2_thread_launch_workflows",
  "orchestration_command_receipts",
  "provider_session_runtime",
  "auth_sessions",
  "auth_pairing_links",
  "peer_environment_links",
];

const PROVIDER_SESSIONS_TABLE = "orchestration_v2_projection_provider_sessions";

// Done threads stay: they are most of real history, and the UI shows them.
const rootIsVisible = (sql: SqlClient.SqlClient) => sql`
  root.deleted_at IS NULL
  AND json_extract(root.payload_json, '$.deletedAt') IS NULL
  AND json_extract(root.payload_json, '$.archivedAt') IS NULL`;

/**
 * Build the snapshot from this checkout's schema, then copy the visible
 * threads' rows in by column name. Columns the source lacks keep their
 * defaults, and source tables this schema dropped are skipped, so a source
 * written by an older or newer build still imports.
 */
const copySourceSlice = Effect.fn("copyDevDbSourceSlice")(function* (sourcePath: string) {
  const sql = yield* SqlClient.SqlClient;
  yield* runMigrations();
  yield* sql`ATTACH DATABASE ${`${NodeURL.pathToFileURL(sourcePath).href}?mode=ro`} AS src`;
  const sourceTables = new Set(
    (yield* sql<{ name: string }>`SELECT name FROM src.sqlite_master WHERE type = 'table'`).map(
      (row) => row.name,
    ),
  );
  // Virtual tables and their shadow tables are left out: FTS5 owns those rows,
  // and the message search index is rebuilt in the compacted copy.
  const tables = (yield* sql<{ name: string }>`
    SELECT name FROM pragma_table_list()
    WHERE schema = 'main' AND type = 'table'
      AND name NOT LIKE 'sqlite_%' AND name <> 'effect_sql_migrations'`)
    .map((row) => row.name)
    .filter((name) => sourceTables.has(name) && !CLEARED_TABLES.includes(name));
  const filtered = sourceTables.has("orchestration_v2_projection_threads");

  yield* sql.withTransaction(
    Effect.gen(function* () {
      if (filtered) {
        yield* sql`CREATE TEMP TABLE copied_threads (thread_id TEXT PRIMARY KEY)`;
        yield* sql`INSERT OR IGNORE INTO copied_threads
          SELECT family.thread_id FROM src.orchestration_v2_projection_threads family
          JOIN src.orchestration_v2_projection_threads root ON root.thread_id =
            COALESCE(json_extract(family.payload_json, '$.lineage.rootThreadId'), family.thread_id)
          WHERE ${rootIsVisible(sql)}`;
      }
      for (const name of tables) {
        const columns = yield* sql<{ name: string; notnull: number }>`
          SELECT target.name, target."notnull"
          FROM pragma_table_info(${name}, 'main') target
          JOIN pragma_table_info(${name}, 'src') source ON source.name = target.name`;
        const threadColumn = columns.find((column) => column.name === "thread_id");
        const filter = !filtered
          ? ""
          : name === "orchestration_events"
            ? `WHERE (aggregate_kind = 'thread' AND stream_id IN (SELECT thread_id FROM copied_threads))
                OR aggregate_kind < 'thread' OR aggregate_kind > 'thread'`
            : threadColumn === undefined || name === PROVIDER_SESSIONS_TABLE
              ? ""
              : `WHERE thread_id IN (SELECT thread_id FROM copied_threads)${threadColumn.notnull === 0 ? " OR thread_id IS NULL" : ""}`;
        const columnList = columns.map((column) => `"${column.name}"`).join(", ");
        yield* sql.unsafe(
          `INSERT OR REPLACE INTO main."${name}" (${columnList}) SELECT ${columnList} FROM src."${name}" ${filter}`,
        ).unprepared;
      }

      if (sourceTables.has("sqlite_sequence")) {
        yield* sql`DELETE FROM main.sqlite_sequence`;
        yield* sql`INSERT INTO main.sqlite_sequence
          SELECT name, seq FROM src.sqlite_sequence
          WHERE name IN (SELECT name FROM main.sqlite_master WHERE type = 'table')`;
      }
    }),
  );
  yield* sql`DETACH DATABASE src`;
});

/**
 * Threads a server started on this database would resume by itself: every startup recovery kind,
 * plus latest-run failures and recovery choices, which usage-limit recovery can resume.
 */
export const resumableThreadIds = Effect.fn("resumableDevDbThreadIds")(function* () {
  const sql = yield* SqlClient.SqlClient;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const recovery = yield* Effect.forEach(RECOVERY_KINDS, (kind) =>
    projections.getRecoveryThreadIds(kind),
  );
  // A task still open in a linked environment would be followed from this copy too.
  const remoteTasks = yield* projections.getOpenRemoteDelegatedTasks;
  const failedOrRecovering = yield* sql<{ thread_id: string }>`
    SELECT r.thread_id FROM orchestration_v2_projection_runs r
    WHERE r.status = 'failed' AND r.ordinal = (
      SELECT MAX(latest.ordinal) FROM orchestration_v2_projection_runs latest
      WHERE latest.thread_id = r.thread_id)
    UNION
    SELECT thread_id FROM orchestration_v2_projection_threads
    WHERE json_extract(payload_json, '$.limitRecovery') IS NOT NULL`;
  return [
    ...new Set<string>([
      ...recovery.flat(),
      ...remoteTasks.map((task) => task.parentThreadId),
      ...failedOrRecovering.map((row) => row.thread_id),
    ]),
  ];
});

export class MigrateDevDbResumableWorkError extends Schema.TaggedError<MigrateDevDbResumableWorkError>()(
  "MigrateDevDbResumableWorkError",
  { databasePath: Schema.String, threads: Schema.Number },
) {
  override get message() {
    return `${this.databasePath} still holds ${this.threads} threads a server would resume.`;
  }
}

/**
 * Drops, in place, every thread family a server started on `databasePath` would resume, and fails
 * if any remain. A database seeded by an older checkout can miss a recovery kind added since.
 */
export const dropResumableFamilies = Effect.fn("dropResumableDevDbFamilies")(function* (
  databasePath: string,
  options: RunMigrateDevDbOptions = {},
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const platform = yield* HostProcess.Platform;
  // A symlink, `..` or another letter case can name the live database; compare where they lead.
  const resolve = (file: string) =>
    fs.realPath(file).pipe(
      Effect.catch(() =>
        fs
          .realPath(path.dirname(file))
          .pipe(Effect.map((dir) => path.join(dir, path.basename(file)))),
      ),
      Effect.orElseSucceed(() => path.resolve(file)),
    );
  const comparable = (resolved: string) =>
    platform === "linux" ? resolved : resolved.toLowerCase();
  // A hard link has its own path, so the file itself is compared too.
  const identity = (file: string) =>
    fs.stat(file).pipe(
      Effect.map((info) => Option.map(info.ino, (ino) => `${info.dev}:${ino}`)),
      Effect.orElseSucceed(() => Option.none<string>()),
    );
  const sharedHome = path.resolve(options.sharedHome ?? path.join(NodeOS.homedir(), ".supaterm"));
  const liveDatabase = path.join(sharedHome, "userdata", "statev2.sqlite");
  const [target, live] = yield* Effect.all([resolve(databasePath), resolve(liveDatabase)]);
  const targetIdentity = yield* identity(target);
  const liveIdentities = yield* Effect.forEach(
    [liveDatabase, `${liveDatabase}-wal`, `${liveDatabase}-shm`],
    identity,
  );
  if (
    comparable(target) === comparable(live) ||
    (Option.isSome(targetIdentity) &&
      liveIdentities.some(
        (candidate) => Option.isSome(candidate) && candidate.value === targetIdentity.value,
      ))
  ) {
    return yield* new MigrateDevDbSharedHomeError();
  }
  // Beside the real file, where a running server keeps its runtime state.
  yield* ensureNotInUse(target);
  return yield* Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const resumable = yield* resumableThreadIds();
    if (resumable.length > 0) {
      yield* sql`CREATE TEMP TABLE resumable_families (thread_id TEXT PRIMARY KEY)`;
      yield* sql`INSERT OR IGNORE INTO resumable_families
        SELECT family.thread_id FROM orchestration_v2_projection_threads family
        WHERE COALESCE(json_extract(family.payload_json, '$.lineage.rootThreadId'), family.thread_id) IN (
          SELECT COALESCE(json_extract(payload_json, '$.lineage.rootThreadId'), thread_id)
          FROM orchestration_v2_projection_threads WHERE thread_id IN ${sql.in(resumable)})`;
      yield* sql.withTransaction(
        Effect.gen(function* () {
          for (const { name } of yield* sql<{ name: string }>`
            SELECT m.name FROM sqlite_master m, pragma_table_info(m.name) c
            WHERE m.type = 'table' AND c.name = 'thread_id'
              AND m.name <> ${PROVIDER_SESSIONS_TABLE}`) {
            yield* sql`DELETE FROM ${sql(name)}
              WHERE thread_id IN (SELECT thread_id FROM resumable_families)`;
          }
          // A session a kept thread still binds stays, as pruning keeps it.
          yield* sql`DELETE FROM ${sql(PROVIDER_SESSIONS_TABLE)}
            WHERE thread_id IN (SELECT thread_id FROM resumable_families)
              AND provider_session_id NOT IN (
                SELECT provider_session_id FROM orchestration_v2_projection_provider_session_bindings
                WHERE thread_id NOT IN (SELECT thread_id FROM resumable_families)
              )`;
          yield* sql`DELETE FROM orchestration_v2_projection_context_transfers
            WHERE source_thread_id IN (SELECT thread_id FROM resumable_families)
               OR target_thread_id IN (SELECT thread_id FROM resumable_families)`;
          yield* sql`DELETE FROM orchestration_events WHERE aggregate_kind = 'thread'
            AND stream_id IN (SELECT thread_id FROM resumable_families)`;
        }),
      );
    }
    const left = yield* resumableThreadIds();
    if (left.length > 0) {
      return yield* new MigrateDevDbResumableWorkError({ databasePath, threads: left.length });
    }
    return resumable.length;
  }).pipe(
    Effect.provide(
      ProjectionStore.layer.pipe(Layer.provideMerge(NodeSqliteClient.layer({ filename: target }))),
    ),
  );
});

const pruneSnapshot = Effect.fn("pruneDevDbSnapshot")(function* (input: RunMigrateDevDbInput) {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`CREATE TEMP TABLE live_threads (thread_id TEXT PRIMARY KEY)`;
  for (const threadId of yield* resumableThreadIds()) {
    yield* sql`INSERT INTO live_threads (thread_id) VALUES (${threadId})`;
  }

  // Forks and subagents read history and results through their lineage, so
  // a thread family is cloned or dropped as a whole. A family is stopped when
  // its root is visible and open and none of its threads is live.
  yield* sql`CREATE TEMP TABLE thread_families AS
    SELECT thread_id, updated_at,
      COALESCE(json_extract(payload_json, '$.lineage.rootThreadId'), thread_id) AS root_id
    FROM orchestration_v2_projection_threads`;

  yield* sql`CREATE TEMP TABLE stopped_families AS
    SELECT f.root_id, root.project_id, MAX(f.updated_at) AS updated_at, COUNT(*) AS size
    FROM thread_families f
    JOIN orchestration_v2_projection_threads root ON root.thread_id = f.root_id
    WHERE ${rootIsVisible(sql)}
    GROUP BY f.root_id, root.project_id
    HAVING SUM(f.thread_id IN (SELECT thread_id FROM live_threads)) = 0`;

  yield* sql`CREATE TEMP TABLE kept_projects AS
    SELECT p.project_id
    FROM projection_projects p
    LEFT JOIN (
      SELECT project_id, MAX(updated_at) AS last_stopped_at
      FROM stopped_families
      GROUP BY project_id
    ) q ON q.project_id = p.project_id
    WHERE p.deleted_at IS NULL
    ORDER BY (q.last_stopped_at IS NULL) ASC,
      COALESCE(q.last_stopped_at, p.updated_at) DESC
    LIMIT ${input.projects}`;

  yield* sql`CREATE TEMP TABLE kept_threads AS
    SELECT f.thread_id FROM thread_families f
    WHERE f.root_id IN (
      SELECT root_id FROM (
        SELECT
          sf.root_id,
          ROW_NUMBER() OVER (
            PARTITION BY sf.project_id
            ORDER BY sf.updated_at DESC
          ) AS recency_rank
        FROM stopped_families sf
        JOIN kept_projects kp ON kp.project_id = sf.project_id
        -- One orchestrator family can hold hundreds of subagents and most of
        -- the database, so a family larger than the limit is skipped.
        WHERE sf.size <= ${input.threadsPerProject}
      )
      WHERE recency_rank <= ${input.threadsPerProject}
    )`;

  // Every thread table is keyed by thread_id, so one sweep covers them and new
  // tables need no change here. Provider sessions are shared between threads
  // and pruned by binding below.
  const threadTables = yield* sql<{ name: string }>`
    SELECT m.name FROM sqlite_master m, pragma_table_info(m.name) c
    WHERE m.type = 'table' AND c.name = 'thread_id'
      AND m.name <> ${PROVIDER_SESSIONS_TABLE}`;

  yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* sql`DELETE FROM projection_projects
        WHERE project_id NOT IN (SELECT project_id FROM kept_projects)`;
      yield* sql`DELETE FROM ${sql(PROVIDER_SESSIONS_TABLE)}
        WHERE COALESCE(thread_id, '') NOT IN (SELECT thread_id FROM kept_threads)
          AND provider_session_id NOT IN (
            SELECT provider_session_id FROM orchestration_v2_projection_provider_session_bindings
            WHERE thread_id IN (SELECT thread_id FROM kept_threads)
          )`;
      for (const { name } of threadTables) {
        yield* sql.unsafe(
          `DELETE FROM "${name}" WHERE thread_id NOT IN (SELECT thread_id FROM kept_threads)`,
        ).unprepared;
      }
      yield* sql`DELETE FROM orchestration_v2_projection_context_transfers
        WHERE source_thread_id NOT IN (SELECT thread_id FROM kept_threads)
           OR target_thread_id NOT IN (SELECT thread_id FROM kept_threads)`;
      yield* sql`DELETE FROM orchestration_events
        WHERE (aggregate_kind = 'thread'
            AND stream_id NOT IN (SELECT thread_id FROM kept_threads))
           OR (aggregate_kind = 'project'
            AND stream_id NOT IN (SELECT project_id FROM kept_projects))`;
      yield* sql`UPDATE orchestration_v2_projection_threads
        SET payload_json = json_set(payload_json, '$.pullRequests', json((
          SELECT json_group_array(json_remove(link.value, '$.watch') ORDER BY link.key)
          FROM json_each(payload_json, '$.pullRequests') AS link)))
        WHERE EXISTS (
          SELECT 1 FROM json_each(payload_json, '$.pullRequests') AS link
          WHERE json_extract(link.value, '$.watch') IS NOT NULL)`;
      // Copied threads keep their real worktree paths, where a done script would run.
      yield* sql`UPDATE projection_projects
        SET scripts_json = (
          SELECT json_group_array(json_remove(script.value, '$.runOnDone') ORDER BY script.key)
          FROM json_each(scripts_json) AS script)
        WHERE EXISTS (
          SELECT 1 FROM json_each(scripts_json) AS script
          WHERE json_extract(script.value, '$.runOnDone') IS NOT NULL)`;
      for (const table of CLEARED_TABLES) {
        yield* sql`DELETE FROM ${sql(table)}`;
      }
    }),
  );

  const keptProjects = yield* sql<{ title: string; threads: number }>`
    SELECT
      p.title,
      (SELECT COUNT(*) FROM orchestration_v2_projection_threads t
        WHERE t.project_id = p.project_id) AS threads
    FROM projection_projects p
    ORDER BY p.updated_at DESC`;
  const [events] = yield* sql<{ count: number }>`
    SELECT COUNT(*) AS count FROM orchestration_events`;

  return {
    projects: keptProjects as ReadonlyArray<KeptProject>,
    eventCount: events?.count ?? 0,
  };
});

export const runMigrateDevDb = Effect.fn("runMigrateDevDb")(function* (
  input: RunMigrateDevDbInput,
  options: RunMigrateDevDbOptions = {},
) {
  // SQLite treats a negative LIMIT as "no limit", which would clone
  // everything. The CLI flags validate this too; this covers direct callers.
  if (input.projects < 1 || input.threadsPerProject < 0) {
    return yield* Effect.die("projects must be >= 1 and threadsPerProject >= 0");
  }
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const sharedHome = path.resolve(
    options.sharedHome ?? resolveDefaultSupatermHome(NodeOS.homedir(), path.join),
  );
  const sourcePath = path.resolve(
    input.source ?? path.join(sharedHome, "userdata", "statev2.sqlite"),
  );

  const baseDir =
    input.baseDir !== undefined
      ? path.resolve(input.baseDir)
      : yield* resolveWorktreeSupatermHome(process.cwd());
  if (baseDir === undefined) {
    return yield* new MigrateDevDbNotInWorktreeError();
  }
  const stateDir = path.join(baseDir, "userdata");
  const databasePath = path.join(stateDir, "statev2.sqlite");
  const snapshotPath = `${databasePath}.migrate-dev-db-tmp`;

  if (!(yield* fs.exists(sourcePath))) {
    return yield* new MigrateDevDbSourceMissingError({ sourcePath });
  }
  const [canonicalBaseDir, canonicalSharedHome] = yield* Effect.all([
    fs.realPath(baseDir).pipe(Effect.orElseSucceed(() => baseDir)),
    fs.realPath(sharedHome).pipe(Effect.orElseSucceed(() => sharedHome)),
  ]);
  if (canonicalBaseDir === canonicalSharedHome) {
    return yield* new MigrateDevDbSharedHomeError();
  }
  // The destination db and snapshot both get deleted below; a --source that
  // resolves to either (e.g. a leftover snapshot file) would be destroyed
  // before it is ever read.
  const canonicalSourcePath = yield* fs
    .realPath(sourcePath)
    .pipe(Effect.orElseSucceed(() => sourcePath));
  for (const destination of [databasePath, snapshotPath]) {
    const canonicalDestination = yield* fs
      .realPath(destination)
      .pipe(Effect.orElseSucceed(() => destination));
    if (canonicalSourcePath === canonicalDestination) {
      return yield* new MigrateDevDbSourceIsDestinationError({ sourcePath });
    }
  }

  yield* fs.makeDirectory(stateDir, { recursive: true });
  yield* ensureNotInUse(databasePath);

  const wrapPhase =
    (phase: MigrateDevDbPhaseError["phase"], phaseDatabasePath: string) =>
    <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(
        Effect.mapError(
          (cause) => new MigrateDevDbPhaseError({ phase, databasePath: phaseDatabasePath, cause }),
        ),
      );

  yield* removeDatabaseFiles(snapshotPath);

  const pruned = yield* Effect.gen(function* () {
    yield* Console.log(`Copying visible threads from ${sourcePath} (read-only)...`);
    yield* copySourceSlice(sourcePath).pipe(
      Effect.provide(NodeSqliteClient.layer({ filename: snapshotPath })),
      wrapPhase("snapshot", sourcePath),
    );

    yield* Console.log(
      `Pruning to ${input.projects} projects, ${input.threadsPerProject} stopped threads each...`,
    );
    const result = yield* pruneSnapshot(input).pipe(
      Effect.provide(
        ProjectionStore.layer.pipe(
          Layer.provideMerge(NodeSqliteClient.layer({ filename: snapshotPath })),
        ),
      ),
      wrapPhase("prune", snapshotPath),
    );

    yield* Console.log(`Compacting into ${databasePath}...`);
    // Re-check right before the swap: a dev server started while the
    // snapshot was migrating and pruning must not lose its database.
    yield* ensureNotInUse(databasePath);
    yield* removeDatabaseFiles(databasePath);
    yield* Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      // VACUUM INTO writes this connection's auto_vacuum mode, so the copy
      // gets the incremental mode a freshly booted server creates.
      yield* sql`PRAGMA auto_vacuum = INCREMENTAL`;
      yield* sql`VACUUM INTO ${databasePath}`;
    }).pipe(
      Effect.provide(NodeSqliteClient.layer({ filename: snapshotPath })),
      wrapPhase("compact", databasePath),
    );
    return result;
  }).pipe(Effect.ensuring(removeDatabaseFiles(snapshotPath)));
  yield* fs.chmod(databasePath, 0o600);

  yield* Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    // WAL does not survive VACUUM INTO; turn it back on like server boot does.
    yield* sql.unsafe("PRAGMA journal_mode = WAL").unprepared;
    // The search index is keyed by message rowid, which VACUUM INTO may renumber.
    yield* rebuildMessageSearch(sql);
  }).pipe(
    Effect.provide(NodeSqliteClient.layer({ filename: databasePath })),
    wrapPhase("compact", databasePath),
  );

  const size = (yield* fs.stat(databasePath)).size;
  return {
    databasePath,
    sizeBytes: Number(size),
    projects: pruned.projects,
    eventCount: pruned.eventCount,
  };
});

const formatSize = (bytes: number): string =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${(bytes / 1024).toFixed(0)} KB`;

export const migrateDevDbCommand = Command.make(
  "migrate-dev-db",
  {
    projects: Flag.Int("projects").pipe(
      Flag.withDefault(5),
      Flag.withDescription("How many recently updated projects to keep."),
    ),
    threadsPerProject: Flag.Int("threads-per-project").pipe(
      Flag.withDefault(10),
      Flag.withDescription(
        "How many recent stopped threads, with their forks and subagents, to keep per project. A family with more threads than this is skipped.",
      ),
    ),
    baseDir: Flag.String("base-dir").pipe(
      Flag.optional,
      Flag.withDescription(
        "Isolated .supaterm directory. Defaults to the current worktree's .supaterm.",
      ),
    ),
    source: Flag.String("source").pipe(
      Flag.optional,
      Flag.withDescription("Source database. Defaults to ~/.supaterm/userdata/statev2.sqlite."),
    ),
    dropResumable: Flag.String("drop-resumable").pipe(
      Flag.optional,
      Flag.withDescription(
        "Only drop, in place, the thread families a server started on this database would resume, and fail if any remain. Copies only; never the live database.",
      ),
    ),
  },
  ({ projects, threadsPerProject, baseDir, source, dropResumable }) =>
    Effect.gen(function* () {
      if (Option.isSome(dropResumable)) {
        const dropped = yield* dropResumableFamilies(dropResumable.value);
        yield* Console.log(`Dropped ${dropped} resumable threads.`);
        return;
      }
      const result = yield* runMigrateDevDb({
        projects,
        threadsPerProject,
        baseDir: Option.getOrUndefined(baseDir),
        source: Option.getOrUndefined(source),
      });
      yield* Console.log("");
      yield* Console.log(
        `Dev database ready: ${result.databasePath} (${formatSize(result.sizeBytes)})`,
      );
      for (const project of result.projects) {
        yield* Console.log(`  ${project.title}: ${project.threads} threads`);
      }
      yield* Console.log(`  ${result.eventCount} orchestration events kept`);
    }),
).pipe(
  Command.withDescription(
    "Rebuild the worktree dev database from this checkout's schema and a pruned copy of the real ~/.supaterm data.",
  ),
);

if (import.meta.main) {
  Command.run(migrateDevDbCommand, { version: "0.0.0" }).pipe(
    Effect.provide(NodeServices.layer),
    NodeRuntime.runMain,
  );
}
