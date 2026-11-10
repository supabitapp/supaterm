import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@supaterm/shared/nodeSqliteClient";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as SqlClient from "effect/sql/SqlClient";
import * as Statement from "effect/sql/Statement";

import * as DatabaseMaintenance from "./DatabaseMaintenance.ts";
import * as Sqlite from "./Sqlite.ts";
import * as EventStore from "../orchestration-v2/EventStore.ts";
import * as ProjectionMaintenance from "../orchestration-v2/ProjectionMaintenance.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";

it.layer(DatabaseMaintenance.layer.pipe(Layer.provideMerge(NodeServices.layer)))(
  "DatabaseMaintenance",
  (it) => {
    it.effect("reports an unreadable database as an inspection failure", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const maintenance = yield* DatabaseMaintenance.DatabaseMaintenance;
        const dbPath = path.join(
          yield* fs.makeTempDirectoryScoped({ prefix: "supaterm-inspect-" }),
          "statev2.sqlite",
        );
        yield* fs.writeFileString(dbPath, "not a database");
        const failure = yield* Effect.flip(maintenance.inspect(dbPath));
        assert.equal(failure._tag, "DatabaseInspectError");
      }).pipe(Effect.scoped),
    );

    it.effect("runs a repair requested from Settings once and keeps its failure for Settings", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const baseDir = yield* fs.makeTempDirectoryScoped({
          prefix: "supaterm-requested-reclaim-",
        });
        const dbPath = path.join(baseDir, "userdata", "statev2.sqlite");
        const files = DatabaseMaintenance.reclaimFiles(path, dbPath);
        // Compaction checks the projections first, so the database needs built ones.
        yield* Effect.flatMap(
          ProjectionMaintenance.ProjectionMaintenanceV2,
          (projections) => projections.rebuild,
        ).pipe(
          Effect.provide(
            ProjectionMaintenance.layer.pipe(
              Layer.provide(Layer.merge(EventStore.layer, ProjectionStore.layer)),
              Layer.provideMerge(Sqlite.layerFromPath(dbPath)),
            ),
          ),
        );
        const autoVacuum = Effect.flatMap(
          SqlClient.SqlClient,
          (sql) => sql<{ readonly auto_vacuum: number }>`PRAGMA auto_vacuum`,
        ).pipe(
          Effect.map((rows) => rows[0]?.auto_vacuum),
          Effect.provide(NodeSqliteClient.layer({ filename: dbPath, readonly: true })),
        );
        yield* Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`PRAGMA auto_vacuum = NONE`;
          yield* sql`VACUUM`;
          yield* sql`CREATE TABLE retained_data (value TEXT)`;
          yield* sql`INSERT INTO retained_data VALUES ('keep')`;
        }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: dbPath })));

        // Every server exit runs this; without a request it must leave the database alone.
        yield* DatabaseMaintenance.runRequestedReclaim(dbPath);
        assert.equal(yield* autoVacuum, 0);

        yield* fs.writeFileString(files.request, "");
        yield* fs.writeFileString(files.failure, "an earlier failure");
        yield* DatabaseMaintenance.runRequestedReclaim(dbPath);
        assert.isFalse(yield* fs.exists(files.request));
        assert.isFalse(yield* fs.exists(files.failure));
        assert.equal(yield* autoVacuum, 2);
        yield* Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          assert.deepEqual(yield* sql`SELECT value FROM retained_data`, [{ value: "keep" }]);
        }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: dbPath, readonly: true })));

        const brokenPath = path.join(baseDir, "broken", "statev2.sqlite");
        const broken = DatabaseMaintenance.reclaimFiles(path, brokenPath);
        yield* fs.makeDirectory(path.dirname(brokenPath));
        yield* fs.writeFileString(brokenPath, "not a database");
        yield* fs.writeFileString(broken.request, "");
        yield* DatabaseMaintenance.runRequestedReclaim(brokenPath);
        assert.isFalse(
          yield* fs.exists(broken.request),
          "a failed repair must not rerun on every exit",
        );
        assert.equal(
          yield* fs.readFileString(broken.failure),
          new DatabaseMaintenance.DatabaseCompactError({ path: brokenPath, cause: null }).message,
        );
      }).pipe(Effect.scoped),
    );

    it.effect("refuses a repair whose copies would not fit on disk", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const dbPath = path.join(
          yield* fs.makeTempDirectoryScoped({ prefix: "supaterm-reclaim-space-" }),
          "statev2.sqlite",
        );
        assert.isNull(yield* DatabaseMaintenance.reclaimSpaceShortfall(dbPath, 1024));
        const huge = 2 ** 60;
        const shortfall = yield* DatabaseMaintenance.reclaimSpaceShortfall(dbPath, huge);
        assert.isAtLeast(shortfall?.neededBytes ?? 0, huge);
        assert.isBelow(shortfall?.freeBytes ?? Infinity, huge);
      }).pipe(Effect.scoped),
    );

    it.effect("compacts an existing database offline only once its server has stopped", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const maintenance = yield* DatabaseMaintenance.DatabaseMaintenance;
        const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "supaterm-compact-" });
        const dbPath = path.join(baseDir, "userdata", "statev2.sqlite");
        // A migrated database created before incremental auto_vacuum, with free pages.
        yield* Effect.flatMap(
          ProjectionMaintenance.ProjectionMaintenanceV2,
          (projections) => projections.rebuild,
        ).pipe(
          Effect.provide(
            ProjectionMaintenance.layer.pipe(
              Layer.provide(Layer.merge(EventStore.layer, ProjectionStore.layer)),
              Layer.provideMerge(Sqlite.layerFromPath(dbPath)),
            ),
          ),
        );
        yield* Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`PRAGMA auto_vacuum = NONE`;
          yield* sql`VACUUM`;
          yield* sql`CREATE TABLE retained_data (value TEXT)`;
          yield* sql`INSERT INTO retained_data VALUES ('keep')`;
          yield* sql`CREATE TABLE discarded_data (value BLOB)`;
          yield* sql`INSERT INTO discarded_data VALUES (zeroblob(4194304))`;
          yield* sql`DROP TABLE discarded_data`;
          yield* sql`
            INSERT INTO orchestration_v2_projection_messages (
              message_id, thread_id, run_id, node_id, role, streaming, created_at, updated_at, payload_json
            )
            VALUES (
              'message-1', 'thread-1', NULL, NULL, 'user', 0,
              '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', '{"text":"needle"}'
            )
          `;
          // An index that drifted from its rows, as a renumbering VACUUM would leave it.
          yield* sql`
            INSERT INTO orchestration_v2_message_search (orchestration_v2_message_search)
            VALUES ('delete-all')
          `;
          yield* sql`PRAGMA wal_checkpoint(TRUNCATE)`;
          yield* sql`WITH RECURSIVE history(n) AS (
            SELECT 1 UNION ALL SELECT n + 1 FROM history WHERE n < 52
          ) INSERT INTO orchestration_events (
            event_id, aggregate_kind, stream_id, stream_version, event_type,
            occurred_at, actor_kind, payload_json, metadata_json, application_event_version
          ) SELECT 'visit-' || n, 'thread', 'thread', n, 'thread.visited',
            '2026-10-17', 'server', '{}', '{}', 2 FROM history`;
          yield* sql`
            UPDATE orchestration_v2_projection_metadata
            SET last_sequence = (SELECT MAX(sequence) FROM orchestration_events)
            WHERE projection_name = 'thread-projections'
          `;
        }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: dbPath })));

        // A server that merely has the database open, like an idle one, is enough to refuse.
        const sizeBefore = (yield* fs.stat(dbPath)).size;
        const refused = yield* Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`SELECT value FROM retained_data`;
          return yield* maintenance.compact(dbPath).pipe(Effect.flip);
        }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: dbPath })));
        assert.equal(refused._tag, "DatabaseInUseError");
        assert.equal((yield* fs.stat(dbPath)).size, sizeBefore);

        const statements: Array<string> = [];
        const record: Statement.Transformer = (statement) =>
          Effect.sync(() => {
            statements.push(statement.compile()[0]);
            return statement;
          });
        const clock = yield* Clock.Clock;
        const pauses: number[] = [];
        let activeNanos = 0n;
        const result = yield* maintenance.compact(dbPath).pipe(
          Effect.provideService(Statement.CurrentTransformer, record),
          Effect.provideService(Clock.Clock, {
            ...clock,
            // Exceed the background budget whenever the compactor checks elapsed time.
            monotonicTimeNanos: Effect.sync(() => (activeNanos += 30_000_000n)),
            sleep: (duration) =>
              Effect.sync(() => {
                pauses.push(Duration.toMillis(duration));
              }),
          }),
        );
        assert.deepEqual(pauses, [], "offline doctor must not throttle compaction");
        assert.equal(result.deletedEventCount, 51);
        const fullFsync = statements.indexOf("PRAGMA checkpoint_fullfsync = ON");
        assert.isAtLeast(fullFsync, 0);
        assert.isBelow(fullFsync, statements.indexOf("VACUUM"));
        // The 4 MiB of free pages are returned to the filesystem.
        assert.isBelow(result.afterBytes, result.beforeBytes - 3 * 1024 * 1024);
        yield* Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          assert.deepEqual(yield* sql`PRAGMA auto_vacuum`, [{ auto_vacuum: 2 }]);
          assert.deepEqual(yield* sql`SELECT value FROM retained_data`, [{ value: "keep" }]);
          assert.deepEqual(
            yield* sql`
              SELECT messages.message_id AS "messageId"
              FROM orchestration_v2_message_search AS search
              INNER JOIN orchestration_v2_projection_messages AS messages
                ON messages.rowid = search.rowid
              WHERE orchestration_v2_message_search MATCH '"needle"'
            `,
            [{ messageId: "message-1" }],
          );
        }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: dbPath, readonly: true })));
      }).pipe(Effect.scoped),
    );
  },
);
