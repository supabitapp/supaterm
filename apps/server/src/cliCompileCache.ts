// @effect-diagnostics nodeBuiltinImport:off -- Runs before the CLI's Effect runtime loads.
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSea from "node:sea";

export function enableCliCompileCache() {
  try {
    if (NodeSea.isSea()) return;
    const cacheRoot =
      process.env.XDG_CACHE_HOME ||
      // oxlint-disable-next-line supaterm/no-global-process-runtime -- Runs before the CLI's Effect runtime loads.
      (process.platform === "linux" ? NodePath.join(NodeOS.homedir(), ".cache") : NodeOS.tmpdir());
    const directory = NodePath.join(cacheRoot, "supaterm", "compile-cache");
    if (process.env.APPIMAGE) {
      for (const entry of NodeFS.readdirSync(directory, { withFileTypes: true })) {
        if (entry.isDirectory() && /^v\d/.test(entry.name)) {
          NodeFS.rmSync(NodePath.join(directory, entry.name), { recursive: true, force: true });
        }
      }
      return;
    }
    NodeModule.enableCompileCache(directory);
  } catch {}
}
