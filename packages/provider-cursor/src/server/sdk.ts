// @effect-diagnostics nodeBuiltinImport:off -- The SDK must load from disk beside its Webpack chunks.
import * as NodeModule from "node:module";

type CursorSdkModule = typeof import("@cursor/sdk");
type CursorSqliteModule = typeof import("@cursor/sdk/sqlite");

export function makeCursorSdkLoaders(
  requireCursorSdk: (id: string) => unknown = NodeModule.createRequire(import.meta.url),
) {
  let sdk: CursorSdkModule | undefined;
  let sqlite: CursorSqliteModule | undefined;

  const loadCursorSdk = () => {
    if (sdk !== undefined) return sdk;
    const start = performance.now();
    sdk = requireCursorSdk("@cursor/sdk") as CursorSdkModule;
    if (process.env.SUPATERM_STARTUP_PROFILE_DIR) {
      performance.measure("provider.cursor.importSdk", { start });
    }
    return sdk;
  };

  const loadCursorSqlite = () => {
    if (sqlite !== undefined) return sqlite;
    const start = performance.now();
    sqlite = requireCursorSdk("@cursor/sdk/sqlite") as CursorSqliteModule;
    if (process.env.SUPATERM_STARTUP_PROFILE_DIR) {
      performance.measure("provider.cursor.importSqliteStore", { start });
    }
    return sqlite;
  };

  const isCursorSdkError = <
    K extends "AuthenticationError" | "ConfigurationError" | "CursorSdkError",
  >(
    cause: unknown,
    kind: K,
  ): cause is InstanceType<CursorSdkModule[K]> => sdk !== undefined && cause instanceof sdk[kind];

  return { loadCursorSdk, loadCursorSqlite, isCursorSdkError };
}

export const { loadCursorSdk, loadCursorSqlite, isCursorSdkError } = makeCursorSdkLoaders();
