import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@supaterm/shared/nodeSqliteClient";
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
          yield* sql`PRAGMA wal_checkpoint(TRUNCATE)`;
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
        const result = yield* maintenance
          .compact(dbPath)
          .pipe(Effect.provideService(Statement.CurrentTransformer, record));
        const fullFsync = statements.indexOf("PRAGMA checkpoint_fullfsync = ON");
        assert.isAtLeast(fullFsync, 0);
        assert.isBelow(fullFsync, statements.indexOf("VACUUM"));
        // The 4 MiB of free pages are returned to the filesystem.
        assert.isBelow(result.afterBytes, result.beforeBytes - 3 * 1024 * 1024);
        yield* Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          assert.deepEqual(yield* sql`PRAGMA auto_vacuum`, [{ auto_vacuum: 2 }]);
          assert.deepEqual(yield* sql`SELECT value FROM retained_data`, [{ value: "keep" }]);
        }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: dbPath, readonly: true })));
      }).pipe(Effect.scoped),
    );
  },
);
