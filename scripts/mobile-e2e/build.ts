// @effect-diagnostics nodeBuiltinImport:off - Native builds run before device startup.
import * as NodeProcess from "node:process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { MOBILE_ROOT, REPO_ROOT, run } from "./process.ts";

export const BUNDLE_ID = "com.supaterm.mobile.dev";
export const BUILD_ENV = {
  ...NodeProcess.env,
  APP_VARIANT: "development",
  MOBILE_VERSION_POLICY: "appVersion",
  SUPATERM_IOS_PERSONAL_TEAM: "0",
  CI: "1",
  EXPO_NO_GIT_STATUS: "1",
};

async function fingerprint(platform: "ios" | "android", destination: string) {
  const { stdout } = await run(
    NodeProcess.execPath,
    [
      "--eval",
      "require('expo/fingerprint').createFingerprintAsync(process.cwd(), { platforms: [process.argv[1]], silent: true }).then(fp => { require('node:fs').writeFileSync(process.argv[2], JSON.stringify(fp, null, 2)); console.log('FINGERPRINT=' + fp.hash); }).catch(error => { console.error(error); process.exitCode = 1; });",
      platform,
      destination,
    ],
    { cwd: MOBILE_ROOT, env: BUILD_ENV, processGroup: true },
  );
  const hash = /^FINGERPRINT=([a-f0-9]{40,64})$/m.exec(stdout)?.[1];
  if (!hash) throw new Error("Expo did not return a native fingerprint.");
  return hash;
}

export async function prepareClient(platform: "ios" | "android", output: string) {
  const hash = await fingerprint(platform, NodePath.join(output, "fingerprint-before.json"));
  const abi =
    platform === "ios"
      ? NodeProcess.arch
      : (NodeProcess.env.ORG_GRADLE_PROJECT_reactNativeArchitectures ??
        NodeProcess.env.SUPATERM_E2E_ANDROID_IMAGE?.split(";").at(-1) ??
        (NodeProcess.arch === "arm64" ? "arm64-v8a" : "x86_64"));
  if (!["arm64", "x64", "arm64-v8a", "x86_64"].includes(abi))
    throw new Error(`Unsupported native architecture: ${abi}`);
  const directory = NodePath.join(
    NodeOS.homedir(),
    ".cache/supaterm/mobile-e2e",
    platform,
    abi,
    hash,
  );
  const artifact = NodePath.join(directory, platform === "ios" ? "SupatermDev.app" : "client.apk");
  if (
    await Promise.all([
      NodeFSP.readFile(NodePath.join(directory, "complete"), "utf8"),
      NodeFSP.stat(artifact),
    ]).then(
      ([stored]) => stored === hash,
      () => false,
    )
  )
    return artifact;

  const nativeDirectory = NodePath.join(MOBILE_ROOT, platform);
  const tracked = await run("git", ["ls-files", `apps/mobile/${platform}`], { cwd: REPO_ROOT });
  if (tracked.stdout.trim())
    throw new Error("Native directory contains tracked files; refusing clean prebuild.");
  if (
    NodeProcess.env.GITHUB_ACTIONS !== "true" &&
    (await NodeFSP.access(nativeDirectory).then(
      () => true,
      () => false,
    ))
  )
    throw new Error(`Use a clean worktree for a cache miss; ${nativeDirectory} already exists.`);

  const temporary = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "supaterm-mobile-build-"));
  const options = {
    cwd: MOBILE_ROOT,
    env: BUILD_ENV,
    logPath: NodePath.join(output, "native-build.log"),
    timeoutMs: 2_700_000,
    processGroup: true,
  };
  try {
    await run(
      "vp",
      ["exec", "expo", "prebuild", "--clean", "--platform", platform, "--no-install"],
      options,
    );
    let built: string;
    if (platform === "ios") {
      await run("pod", ["install"], { ...options, cwd: nativeDirectory });
      await run(
        "xcrun",
        [
          "xcodebuild",
          "-workspace",
          NodePath.join(nativeDirectory, "SupatermDev.xcworkspace"),
          "-scheme",
          "SupatermDev",
          "-configuration",
          "Debug",
          "-sdk",
          "iphonesimulator",
          "-destination",
          "generic/platform=iOS Simulator",
          "-derivedDataPath",
          temporary,
          `ARCHS=${abi === "x64" ? "x86_64" : abi}`,
          "ONLY_ACTIVE_ARCH=YES",
          "COMPILER_INDEX_STORE_ENABLE=NO",
          "build",
        ],
        { ...options, env: { ...BUILD_ENV, RCT_NO_LAUNCH_PACKAGER: "true" } },
      );
      built = NodePath.join(temporary, "Build/Products/Debug-iphonesimulator/SupatermDev.app");
    } else {
      await run(
        "./gradlew",
        [
          "app:assembleDebug",
          "-x",
          "lint",
          "-x",
          "test",
          "--configure-on-demand",
          "--build-cache",
          `-PreactNativeArchitectures=${abi}`,
        ],
        { ...options, cwd: nativeDirectory },
      );
      built = NodePath.join(nativeDirectory, "app/build/outputs/apk/debug/app-debug.apk");
    }
    const verified = await fingerprint(platform, NodePath.join(output, "fingerprint-after.json"));
    if (verified !== hash)
      throw new Error("Native inputs changed during the build; refusing to cache the client.");
    await NodeFSP.mkdir(directory, { recursive: true });
    await NodeFSP.cp(built, artifact, { recursive: platform === "ios" });
    await NodeFSP.writeFile(NodePath.join(directory, "complete"), hash);
    return artifact;
  } finally {
    await NodeFSP.rm(temporary, { recursive: true, force: true });
  }
}
