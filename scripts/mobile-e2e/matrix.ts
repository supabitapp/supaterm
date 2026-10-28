// @effect-diagnostics nodeBuiltinImport:off - CI selects devices before dependencies are installed.
import * as NodeFS from "node:fs";
import * as NodeProcess from "node:process";

import { selectPoses } from "./poses.ts";

const platform = NodeProcess.env.MOBILE_PLATFORM ?? "all";
if (platform !== "all" && platform !== "ios" && platform !== "android")
  throw new Error(`Unknown platform: ${platform}`);
const selected = (NodeProcess.env.E2E_POSES ?? "").split(/\s+/).filter(Boolean);
const include = selectPoses(platform, selected).map((pose) => ({
  platform: pose.platform,
  pose: pose.id,
}));
if (!include.length) throw new Error("No poses match the selected platform.");
if (!NodeProcess.env.GITHUB_OUTPUT) throw new Error("GITHUB_OUTPUT is required.");
NodeFS.appendFileSync(NodeProcess.env.GITHUB_OUTPUT, `value=${JSON.stringify({ include })}\n`);
