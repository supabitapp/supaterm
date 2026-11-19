// @effect-diagnostics nodeBuiltinImport:off
import * as NodeURL from "node:url";

export function vitePlusCommand(
  args: ReadonlyArray<string>,
  // oxlint-disable-next-line supaterm/no-global-process-runtime -- Standalone Node tooling has no Effect runtime; tests pass the platform explicitly.
  platform: NodeJS.Platform = process.platform,
) {
  if (platform === "win32") {
    return [
      process.execPath,
      [NodeURL.fileURLToPath(import.meta.resolve("vite-plus/bin")), ...args],
    ] satisfies [command: string, args: Array<string>];
  }
  return ["vp", [...args]] satisfies [command: string, args: Array<string>];
}
