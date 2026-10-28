// @effect-diagnostics nodeBuiltinImport:off - CI selects devices before dependencies are installed.
import * as NodeFS from "node:fs";
import * as NodeProcess from "node:process";

import { selectPoses } from "./poses.ts";

const platform = NodeProcess.env.MOBILE_PLATFORM ?? "all";
if (platform !== "all" && platform !== "ios" && platform !== "android")
  throw new Error(`Unknown platform: ${platform}`);
const selected = (NodeProcess.env.E2E_POSES ?? "").split(/\s+/).filter(Boolean);
const poses = selectPoses(platform, selected);
const iosRunner = NodeProcess.env.MOBILE_IOS_RUNNER ?? "xcode-27";
if (iosRunner !== "xcode-27" && iosRunner !== "macos-26")
  throw new Error(`Unsupported free iOS runner: ${iosRunner}`);
if (
  iosRunner === "macos-26" &&
  poses.some((pose) => pose.platform !== "ios" || !pose.iosDeviceType.startsWith("iPad-"))
)
  throw new Error("The macOS 26 comparison supports only selected iPad poses.");
const include = poses
  .filter((pose) => pose.platform === "ios")
  .map((pose) => ({
    platform: "ios",
    name: iosRunner === "macos-26" ? `${pose.id}-ios-26-5` : pose.id,
    poses: pose.id,
    runner: iosRunner,
  }));
const android = poses.filter((pose) => pose.platform === "android");
if (android.length)
  include.push({
    platform: "android",
    name: "android",
    poses: android.map((pose) => pose.id).join(" "),
    runner: "ubuntu-24.04",
  });
if (!include.length) throw new Error("No poses match the selected platform.");
if (!NodeProcess.env.GITHUB_OUTPUT) throw new Error("GITHUB_OUTPUT is required.");
NodeFS.appendFileSync(NodeProcess.env.GITHUB_OUTPUT, `value=${JSON.stringify({ include })}\n`);
