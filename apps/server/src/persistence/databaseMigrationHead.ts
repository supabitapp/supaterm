// @effect-diagnostics nodeBuiltinImport:off - read synchronously by the preflight subprocess and at startup.
import * as NodeFS from "node:fs";
import * as NodeSqlite from "node:sqlite";

import { migrationManifest } from "./Migrations.ts";

export const BUILD_MIGRATION_HEAD = Math.max(...migrationManifest.map(([id]) => id));

export function recordedMigrations(
  databasePath: string,
): ReadonlyArray<{ readonly id: number; readonly name: string }> | null {
  let db: NodeSqlite.DatabaseSync;
  try {
    db = new NodeSqlite.DatabaseSync(databasePath, { readOnly: true });
  } catch {
    return NodeFS.existsSync(databasePath) ? null : [];
  }
  try {
    const hasTable = db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'effect_sql_migrations'",
      )
      .get();
    if (hasTable === undefined) return [];
    const rows = db
      .prepare("SELECT migration_id, name FROM effect_sql_migrations ORDER BY migration_id")
      .all();
    if (
      rows.some(
        (row) =>
          !Number.isSafeInteger(Number(row.migration_id)) ||
          Number(row.migration_id) < 1 ||
          typeof row.name !== "string" ||
          row.name.length === 0,
      )
    )
      return null;
    return rows.map((row) => ({ id: Number(row.migration_id), name: String(row.name) }));
  } catch {
    return null;
  } finally {
    try {
      db.close();
    } catch {}
  }
}

export function databaseMigrationHead(databasePath: string): number | undefined {
  const recorded = recordedMigrations(databasePath);
  if (recorded === null) return undefined;
  const known = new Map<number, string>(migrationManifest);
  if (recorded.some(({ id, name }) => known.has(id) && known.get(id) !== name)) return undefined;
  const recordedHead = Math.max(0, ...recorded.map(({ id }) => id));
  const head = Math.max(BUILD_MIGRATION_HEAD, recordedHead);
  if (
    migrationManifest.some(
      ([id, name]) =>
        id <= recordedHead && !recorded.some((entry) => entry.id === id && entry.name === name),
    )
  )
    return undefined;
  return head;
}
