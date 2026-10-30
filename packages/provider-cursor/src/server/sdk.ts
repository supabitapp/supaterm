// @effect-diagnostics nodeBuiltinImport:off -- The SDK must load from disk beside its Webpack chunks.
import * as NodeModule from "node:module";

const requireCursorSdk = NodeModule.createRequire(import.meta.url);
export const {
  Agent,
  AuthenticationError,
  ConfigurationError,
  createAgentPlatform,
  Cursor,
  CursorSdkError,
  InMemoryCredentialStore,
} = requireCursorSdk("@cursor/sdk") as typeof import("@cursor/sdk");
export const { SqliteLocalAgentStore } = requireCursorSdk(
  "@cursor/sdk/sqlite",
) as typeof import("@cursor/sdk/sqlite");
