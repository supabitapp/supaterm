import * as NodeModule from "node:module";

if (
  process.env.VP_SUPATERM_TASK_CACHE_MODE &&
  process.env.VP_REMOTE_CACHE === process.env.VP_SUPATERM_TASK_CACHE_MODE
)
  delete process.env.VP_REMOTE_CACHE;

if (
  typeof NodeModule.registerHooks === "function" &&
  Number(process.versions.node.split(".")[0]) >= 24
) {
  try {
    const { patchNativeCli } = await import("./nativeHook.js");
    const hookUrl = new URL("./nativeRunHook.js", import.meta.url).href;
    NodeModule.registerHooks({
      load(url, context, nextLoad) {
        const loaded = nextLoad(url, context);
        if (!url.endsWith("/vite-plus/dist/bin.js")) return loaded;
        try {
          const source =
            typeof loaded.source === "string"
              ? loaded.source
              : Buffer.from(loaded.source).toString();
          return {
            ...loaded,
            source: patchNativeCli(source).replace(
              'from "./run-hook.js"',
              `from ${JSON.stringify(hookUrl)}`,
            ),
          };
        } catch {
          return loaded;
        }
      },
    });
  } catch {
    // Restricted Node processes must still run when the optional hook cannot load.
  }
}
