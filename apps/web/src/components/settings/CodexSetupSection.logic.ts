import type { PreparedConnection } from "@supaterm/client-runtime/connection";
import { isLoopbackHost } from "@supaterm/shared/preview";

export function isLocalProviderAuthConnection(connection: PreparedConnection | null): boolean {
  return (
    connection !== null &&
    connection.connectionMethod !== "relay" &&
    isLoopbackHost(new URL(connection.httpBaseUrl).hostname)
  );
}

export function readCodexSetupMode(config: unknown): "managed" | "existing" {
  return config !== null &&
    typeof config === "object" &&
    "setupMode" in config &&
    config.setupMode === "managed"
    ? "managed"
    : "existing";
}
