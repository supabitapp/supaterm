// @effect-diagnostics nodeBuiltinImport:off -- The SDK must load from disk beside its Webpack chunks.
import * as NodeModule from "node:module";

const requireCursorSdk = NodeModule.createRequire(import.meta.url);
let sdk: typeof import("@cursor/sdk") | undefined;
let sqlite: typeof import("@cursor/sdk/sqlite") | undefined;

export function loadCursorSdk(): typeof import("@cursor/sdk") {
  if (sdk !== undefined) return sdk;
  const start = performance.now();
  sdk = requireCursorSdk("@cursor/sdk") as typeof import("@cursor/sdk");
  if (process.env.SUPATERM_STARTUP_PROFILE_DIR) {
    performance.measure("provider.cursor.importSdk", { start });
  }
  return sdk;
}

export function loadCursorSqlite(): typeof import("@cursor/sdk/sqlite") {
  if (sqlite !== undefined) return sqlite;
  const start = performance.now();
  sqlite = requireCursorSdk("@cursor/sdk/sqlite") as typeof import("@cursor/sdk/sqlite");
  if (process.env.SUPATERM_STARTUP_PROFILE_DIR) {
    performance.measure("provider.cursor.importSqliteStore", { start });
  }
  return sqlite;
}

export function isCursorSdkError<
  K extends "AuthenticationError" | "ConfigurationError" | "CursorSdkError",
>(cause: unknown, kind: K): cause is InstanceType<(typeof import("@cursor/sdk"))[K]> {
  return sdk !== undefined && cause instanceof sdk[kind];
}
