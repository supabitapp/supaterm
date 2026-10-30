// @effect-diagnostics nodeBuiltinImport:off - runs inside Vite+ before project services start.
import * as NodeChildProcess from "node:child_process";
import * as NodeURL from "node:url";
import { remoteCacheUrl } from "./remoteCache.ts";
import { flushTelemetry, observeSummaries } from "./telemetry.ts";

export default function start({ root }: { readonly root: string }) {
  const url = remoteCacheUrl(root);
  if (!url) return;
  const endpoint = new URL(url);
  endpoint.username = "";
  endpoint.password = "";
  const stop =
    process.env.SUPATERM_TASK_CACHE_TELEMETRY !== "on"
      ? undefined
      : observeSummaries(root, endpoint.href.replace(/\/$/, ""), process.env);
  const finish = async () => {
    if (!stop) return;
    stop();

    if (process.env.GITHUB_ACTIONS === "true") {
      await flushTelemetry();
      return;
    }

    const child = NodeChildProcess.spawn(
      process.execPath,
      [NodeURL.fileURLToPath(new URL("./flush.ts", import.meta.url))],
      {
        detached: true,
        stdio: "ignore",
        env: { ...process.env, NODE_OPTIONS: "" },
      },
    );
    child.on("error", () => {});
    child.unref();
  };
  return Object.assign(finish, {
    remoteCache:
      process.env.VP_REMOTE_CACHE || process.env.VP_SUPATERM_TASK_CACHE_MODE || "read-write",
  });
}
