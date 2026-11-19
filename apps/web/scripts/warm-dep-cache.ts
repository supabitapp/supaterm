// @effect-diagnostics nodeBuiltinImport:off - plain Node script that dev-runner spawns on a cold cache.
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { optimizeDeps, resolveConfig } from "vite";

const webRoot = NodePath.dirname(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)));

const configStart = performance.now();
const config = await resolveConfig({ root: webRoot, logLevel: "error" }, "serve");
if (process.env.SUPATERM_STARTUP_PROFILE_DIR) {
  performance.measure("web.warmDepCache.resolveConfig", { start: configStart });
}
const optimizeStart = performance.now();
await optimizeDeps(config);
if (process.env.SUPATERM_STARTUP_PROFILE_DIR) {
  performance.measure("web.warmDepCache.optimizeDeps", { start: optimizeStart });
}
console.log("[warm-dep-cache] web dependency cache is warm");
