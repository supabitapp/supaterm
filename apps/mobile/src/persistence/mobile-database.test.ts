import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { vi } from "vite-plus/test";

const openDatabaseAsync = vi.hoisted(() => vi.fn());

vi.mock("expo-sqlite", () => ({ openDatabaseAsync }));

import * as MobileDatabase from "./mobile-database";

describe("offline pull request cache", () => {
  const environmentId = "cached-environment" as import("@supaterm/contracts").EnvironmentId;
  const otherEnvironment = "other-environment" as import("@supaterm/contracts").EnvironmentId;
  type SQLiteValue = string | number | null | Uint8Array;

  interface TestSQLiteDatabase {
    readonly execAsync: (sql: string) => Promise<void>;
    readonly runAsync: (sql: string, ...args: Array<SQLiteValue>) => Promise<unknown>;
    readonly getFirstAsync: <T>(sql: string, ...args: Array<SQLiteValue>) => Promise<T | null>;
    readonly getAllAsync: <T>(
      sql: string,
      ...args: Array<SQLiteValue>
    ) => Promise<ReadonlyArray<T>>;
    readonly withExclusiveTransactionAsync: (
      run: (transaction: TestSQLiteDatabase) => Promise<void>,
    ) => Promise<void>;
    readonly closeAsync: () => Promise<void>;
  }

  async function sqliteDatabase(options?: {
    readonly failMigration?: boolean;
    readonly schemaVersion?: number;
  }) {
    const { DatabaseSync } = await import("node:sqlite");
    const sqlite = new DatabaseSync(":memory:");
    const database: TestSQLiteDatabase = {
      execAsync: async (sql: string) => {
        if (options?.failMigration && sql.includes("CREATE TABLE")) {
          sqlite.exec(sql.slice(0, sql.indexOf(";") + 1));
          throw new Error("migration failed");
        }
        sqlite.exec(sql);
      },
      runAsync: async (sql: string, ...args: Array<SQLiteValue>) =>
        sqlite.prepare(sql).run(...args),
      getFirstAsync: async <T>(sql: string, ...args: Array<SQLiteValue>) =>
        (sqlite.prepare(sql).get(...args) as T | undefined) ?? null,
      getAllAsync: async <T>(sql: string, ...args: Array<SQLiteValue>) =>
        sqlite.prepare(sql).all(...args) as Array<T>,
      withExclusiveTransactionAsync: async (run) => {
        sqlite.exec("BEGIN EXCLUSIVE");
        try {
          await run(database);
          sqlite.exec("COMMIT");
        } catch (error) {
          sqlite.exec("ROLLBACK");
          throw error;
        }
      },
      closeAsync: async () => {
        sqlite.close();
      },
    };
    if (options?.schemaVersion !== undefined) {
      sqlite.exec(`PRAGMA user_version = ${options.schemaVersion}`);
    }
    openDatabaseAsync.mockResolvedValueOnce(database);
    return sqlite;
  }

  it.effect("creates the schema and records its version on a fresh database", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const sqlite = yield* Effect.promise(() => sqliteDatabase());
        yield* MobileDatabase.make;

        expect(sqlite.prepare("PRAGMA user_version").get()).toEqual({
          user_version: MobileDatabase.DATABASE_SCHEMA_VERSION,
        });
        expect(
          sqlite
            .prepare(
              "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'client_cache'",
            )
            .get(),
        ).toEqual({ name: "client_cache" });
      }),
    ),
  );

  it.effect("rejects a database created by a newer client", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const sqlite = yield* Effect.promise(() =>
          sqliteDatabase({ schemaVersion: MobileDatabase.DATABASE_SCHEMA_VERSION + 1 }),
        );
        const database = yield* MobileDatabase.make;
        const result = yield* Effect.result(database.loadPreferencesJson);

        expect(result).toMatchObject({
          _tag: "Failure",
          failure: { _tag: "MobileDatabaseError", operation: "migrate" },
        });
        expect(sqlite.prepare("PRAGMA user_version").get()).toEqual({
          user_version: MobileDatabase.DATABASE_SCHEMA_VERSION + 1,
        });
      }),
    ),
  );

  it.effect("rolls back a failed migration", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const sqlite = yield* Effect.promise(() => sqliteDatabase({ failMigration: true }));
        const database = yield* MobileDatabase.make;
        const result = yield* Effect.result(database.loadPreferencesJson);

        expect(result).toMatchObject({
          _tag: "Failure",
          failure: { _tag: "MobileDatabaseError", operation: "migrate" },
        });
        expect(sqlite.prepare("PRAGMA user_version").get()).toEqual({ user_version: 0 });
        expect(
          sqlite
            .prepare(
              "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'client_cache'",
            )
            .get(),
        ).toBeUndefined();
      }),
    ),
  );

  it.effect("restores saved records and clears them with the environment", () =>
    Effect.scoped(
      Effect.gen(function* () {
        yield* Effect.promise(() => sqliteDatabase());
        const database = yield* MobileDatabase.make;
        yield* database.saveCache(environmentId, "pull-request", "v1:list", 1, '{"entries":[]}');
        yield* database.saveCache(otherEnvironment, "pull-request", "v1:list", 1, "other");
        expect(yield* database.loadCache(environmentId, "pull-request", "v1:list")).toEqual(
          Option.some('{"entries":[]}'),
        );
        yield* database.clearEnvironmentCache(environmentId);
        expect((yield* database.loadCache(environmentId, "pull-request", "v1:list"))._tag).toBe(
          "None",
        );
        expect((yield* database.loadCache(otherEnvironment, "pull-request", "v1:list"))._tag).toBe(
          "Some",
        );
      }),
    ),
  );
});
