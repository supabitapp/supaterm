import { expect, it } from "@effect/vitest";

import { runServicePreflight } from "./servicePreflight.ts";
// @effect-diagnostics nodeBuiltinImport:off -- creates isolated migration histories for native preflight reads.
import * as NodeSqlite from "node:sqlite";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { migrationManifest } from "../persistence/Migrations.ts";
import { SERVICE_LAUNCHER_PROTOCOL } from "./serviceProtocol.ts";

it.each([1, 2])("blocks legacy launcher protocol %i", (launcherProtocol) => {
  expect(
    runServicePreflight({
      launcherProtocol,
      version: "1.2.3",
    }),
  ).toMatchObject({ status: "blocked", version: "1.2.3" });
  const result = runServicePreflight({ launcherProtocol, version: "1.2.3" });
  if (result.status !== "blocked") throw new Error("Expected a blocked launcher");
  expect(result.reason).toContain(`protocol ${launcherProtocol}`);
  expect(result.reason).toContain("SUPATERM_VERSION=1.2.3");
  expect(result.reason).toContain("https://supaterm.com/install.sh");
  expect(result.reason).toContain("~/.local/bin/supaterm service install");
  expect(result.reason).not.toContain("supaterm service update");
});

it.effect.each(["matching", "different baseline", "newer migration"] as const)(
  "validates the %s migration history for an explicit track switch",
  (scenario) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped();
      const databasePath = path.join(directory, "state.sqlite");
      const db = new NodeSqlite.DatabaseSync(databasePath);
      try {
        db.exec("CREATE TABLE effect_sql_migrations (migration_id INTEGER, name TEXT)");
        const insert = db.prepare("INSERT INTO effect_sql_migrations VALUES (?, ?)");
        for (const [id, name] of migrationManifest) {
          insert.run(id, scenario === "different baseline" && id === 1 ? "ForeignBaseline" : name);
        }
        if (scenario === "newer migration") insert.run(100_000, "FutureSchema");
      } finally {
        db.close();
      }
      const guarded = runServicePreflight({
        launcherProtocol: SERVICE_LAUNCHER_PROTOCOL,
        databasePath,
      });
      expect(guarded.status).toBe(scenario === "matching" ? "ready" : "blocked");
      expect(runServicePreflight({ launcherProtocol: SERVICE_LAUNCHER_PROTOCOL }).status).toBe(
        "ready",
      );
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
);
