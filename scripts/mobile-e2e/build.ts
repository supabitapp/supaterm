// @effect-diagnostics nodeBuiltinImport:off - Native build artifacts belong to the host running the device.
import * as NodeProcess from "node:process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { androidSdkTool } from "../mobile-showcase.ts";
import { REPO_ROOT, run } from "./process.ts";

export const BUNDLE_ID = "com.supaterm.mobile.dev";
export const BUILD_ENV = {
  ...NodeProcess.env,
  APP_VARIANT: "development",
  MOBILE_VERSION_POLICY: "appVersion",
  SUPATERM_IOS_PERSONAL_TEAM: "0",
  CI: "1",
  EXPO_NO_GIT_STATUS: "1",
};

async function nativeClient(
  mode: "check" | "ensure",
  platform: "ios" | "android",
  deviceId: string,
  logPath?: string,
) {
  const { code, stdout, stderr } = await run(
    NodeProcess.execPath,
    ["scripts/mobile-native-client.ts", mode, platform, deviceId],
    {
      cwd: REPO_ROOT,
      env: BUILD_ENV,
      allowFailure: mode === "check",
      timeoutMs: mode === "ensure" ? 2_700_000 : 120_000,
      ...(logPath ? { logPath } : {}),
    },
  );
  if (code !== 0 && !(mode === "check" && code === 2))
    throw new Error(`Native client ${mode} failed (${code}): ${(stderr || stdout).slice(-4_000)}`);
  const line = stdout.trim().split(/\r?\n/).at(-1);
  const result = JSON.parse(line ?? "null") as { fingerprint?: unknown } | null;
  if (typeof result?.fingerprint !== "string" || !/^[a-f0-9]{40,64}$/.test(result.fingerprint))
    throw new Error(`Native client ${mode} did not return a fingerprint.`);
  return result.fingerprint;
}

export async function prepareClient(
  platform: "ios" | "android",
  deviceId: string,
  logPath: string,
) {
  const fingerprint = await nativeClient("check", platform, deviceId);
  const abi =
    platform === "ios"
      ? NodeProcess.arch
      : (
          await run(androidSdkTool("platform-tools/adb"), [
            "-s",
            deviceId,
            "shell",
            "getprop",
            "ro.product.cpu.abi",
          ])
        ).stdout.trim();
  if (!["arm64", "x64", "arm64-v8a", "x86_64"].includes(abi))
    throw new Error(`Unsupported native architecture: ${abi}`);
  const platformDirectory = NodePath.join(
    NodeOS.homedir(),
    ".cache/supaterm/mobile-e2e",
    platform,
    abi,
  );
  const directory = NodePath.join(platformDirectory, fingerprint);
  const artifact = NodePath.join(directory, platform === "ios" ? "SupatermDev.app" : "client.apk");
  if (
    await Promise.all([
      NodeFSP.readFile(NodePath.join(directory, "complete"), "utf8"),
      NodeFSP.stat(artifact),
    ]).then(
      ([stored]) => stored === fingerprint,
      () => false,
    )
  )
    return artifact;
  const verifiedFingerprint = await nativeClient("ensure", platform, deviceId, logPath);
  if (verifiedFingerprint !== fingerprint)
    throw new Error("Native inputs changed while preparing the cached client.");
  await NodeFSP.mkdir(directory, { recursive: true });
  if (platform === "ios") {
    const { stdout: installed } = await run("xcrun", [
      "simctl",
      "get_app_container",
      deviceId,
      BUNDLE_ID,
      "app",
    ]);
    await NodeFSP.cp(installed.trim(), artifact, { recursive: true });
  } else {
    const { stdout: packages } = await run(androidSdkTool("platform-tools/adb"), [
      "-s",
      deviceId,
      "shell",
      "pm",
      "path",
      BUNDLE_ID,
    ]);
    const paths = packages
      .trim()
      .split(/\r?\n/)
      .filter((line) => line.startsWith("package:"))
      .map((line) => line.slice(8));
    if (paths.length !== 1) throw new Error(`Expected one development APK, got ${paths.length}.`);
    await run(androidSdkTool("platform-tools/adb"), ["-s", deviceId, "pull", paths[0]!, artifact]);
  }
  await NodeFSP.writeFile(NodePath.join(directory, "complete"), fingerprint);
  return artifact;
}
