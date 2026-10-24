import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import {
  MAC_ICON_NAME,
  XCODE_REQUIREMENT,
  isSupportedXcodeVersion,
  macIconCompilerArguments,
} from "../../../scripts/lib/mac-icon-assets.ts";
import { ensureElectronRuntime } from "./ensure-electron-runtime.mjs";

const isDevelopment = Boolean(process.env.VITE_DEV_SERVER_URL);
const __dirname = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
export const desktopDir = NodePath.resolve(__dirname, "..");
const repoRoot = NodePath.resolve(desktopDir, "..", "..");
const devBundleIdSuffix = NodePath.basename(repoRoot)
  .toLowerCase()
  .replaceAll(/[^a-z0-9]+/g, "");
const APP_DISPLAY_NAME = isDevelopment ? "Supaterm (Dev)" : "Supaterm";
const APP_BUNDLE_ID = isDevelopment
  ? `com.supaterm.desktop.dev.${devBundleIdSuffix || "local"}`
  : "com.supaterm.desktop";
const APP_PROTOCOL_SCHEMES = isDevelopment ? ["supaterm-dev"] : ["supaterm"];
const LAUNCHER_VERSION = 21;
// oxlint-disable-next-line supaterm/no-global-process-runtime -- Standalone launcher script has no Effect runtime.
const hostPlatform = NodeOS.platform();

function setPlistString(plistPath, key, value) {
  const replaceResult = NodeChildProcess.spawnSync(
    "plutil",
    ["-replace", key, "-string", value, plistPath],
    {
      encoding: "utf8",
    },
  );
  if (replaceResult.status === 0) {
    return;
  }

  const insertResult = NodeChildProcess.spawnSync(
    "plutil",
    ["-insert", key, "-string", value, plistPath],
    {
      encoding: "utf8",
    },
  );
  if (insertResult.status === 0) {
    return;
  }

  const details = [replaceResult.stderr, insertResult.stderr].filter(Boolean).join("\n");
  throw new Error(`Failed to update plist key "${key}" at ${plistPath}: ${details}`.trim());
}

function setPlistJson(plistPath, key, value) {
  const serialized = JSON.stringify(value);
  const replaceResult = NodeChildProcess.spawnSync(
    "plutil",
    ["-replace", key, "-json", serialized, plistPath],
    {
      encoding: "utf8",
    },
  );
  if (replaceResult.status === 0) {
    return;
  }

  const insertResult = NodeChildProcess.spawnSync(
    "plutil",
    ["-insert", key, "-json", serialized, plistPath],
    {
      encoding: "utf8",
    },
  );
  if (insertResult.status === 0) {
    return;
  }

  const details = [replaceResult.stderr, insertResult.stderr].filter(Boolean).join("\n");
  throw new Error(`Failed to update plist key "${key}" at ${plistPath}: ${details}`.trim());
}

function runChecked(command, args) {
  const result = NodeChildProcess.spawnSync(command, args, { encoding: "utf8" });
  if (result.status === 0) {
    return;
  }

  const details = [result.stdout, result.stderr].filter(Boolean).join("\n");
  throw new Error(`Failed to run ${command} ${args.join(" ")}: ${details}`.trim());
}

export function resolveMacCodeSignArguments(appBundlePath) {
  return ["--force", "--deep", "--sign", "-", "--timestamp=none", appBundlePath];
}

function signMacLauncherBundle(appBundlePath) {
  runChecked("codesign", resolveMacCodeSignArguments(appBundlePath));
}

function shellSingleQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function makeDevelopmentEnvironmentScript(environment) {
  const envEntries = [
    ["VITE_DEV_SERVER_URL", environment.VITE_DEV_SERVER_URL],
    ["SUPATERM_PORT", environment.SUPATERM_PORT],
    ["SUPATERM_HOME", environment.SUPATERM_HOME],
    ["SUPATERM_COMMIT_HASH", environment.SUPATERM_COMMIT_HASH],
    ["SUPATERM_OTLP_TRACES_URL", environment.SUPATERM_OTLP_TRACES_URL],
    ["SUPATERM_OTLP_EXPORT_INTERVAL_MS", environment.SUPATERM_OTLP_EXPORT_INTERVAL_MS],
    ["SUPATERM_OTLP_HEADERS", environment.SUPATERM_OTLP_HEADERS],
    ["SUPATERM_OTLP_PROTOCOL", environment.SUPATERM_OTLP_PROTOCOL],
    ["SUPATERM_DESKTOP_APP_USER_MODEL_ID", APP_BUNDLE_ID],
  ].filter((entry) => typeof entry[1] === "string" && entry[1].trim().length > 0);
  return [
    ...envEntries.map(
      ([name, value]) =>
        `if [ -z "\${${name}:-}" ]; then export ${name}=${shellSingleQuote(value)}; fi`,
    ),
    "",
  ].join("\n");
}

export function makeDevelopmentLauncherScript({
  electronBinaryPath,
  mainEntryPath,
  desktopRoot,
  environmentFilePath,
}) {
  return [
    "#!/bin/sh",
    `if [ -f ${shellSingleQuote(environmentFilePath)} ]; then . ${shellSingleQuote(environmentFilePath)}; fi`,
    `exec ${shellSingleQuote(electronBinaryPath)} --supaterm-dev-root=${shellSingleQuote(desktopRoot)} ${shellSingleQuote(mainEntryPath)} "$@"`,
    "",
  ].join("\n");
}

const developmentEnvironmentFilePath = NodePath.join(
  desktopDir,
  ".electron-runtime",
  "dev-environment.sh",
);

function writeDevelopmentEnvironmentScript() {
  NodeFS.mkdirSync(NodePath.dirname(developmentEnvironmentFilePath), { recursive: true });
  NodeFS.writeFileSync(
    developmentEnvironmentFilePath,
    makeDevelopmentEnvironmentScript(process.env),
  );
}

export function writeDevelopmentLauncherScript(targetBinaryPath, electronBinaryPath) {
  const script = makeDevelopmentLauncherScript({
    electronBinaryPath,
    mainEntryPath: NodePath.join(desktopDir, "dist-electron", "main.cjs"),
    desktopRoot: desktopDir,
    environmentFilePath: developmentEnvironmentFilePath,
  });
  if (
    NodeFS.existsSync(targetBinaryPath) &&
    NodeFS.readFileSync(targetBinaryPath, "utf8") === script
  ) {
    NodeFS.chmodSync(targetBinaryPath, 0o755);
    return false;
  }
  NodeFS.writeFileSync(targetBinaryPath, script);
  NodeFS.chmodSync(targetBinaryPath, 0o755);
  return true;
}

function registerMacLauncherBundle(appBundlePath) {
  runChecked(
    "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister",
    ["-f", appBundlePath],
  );

  if (!isDevelopment) {
    return;
  }

  for (const scheme of APP_PROTOCOL_SCHEMES) {
    runChecked("osascript", [
      "-l",
      "JavaScript",
      "-e",
      [
        'ObjC.import("CoreServices");',
        `const scheme = $.NSString.alloc.initWithUTF8String(${JSON.stringify(scheme)});`,
        `const bundle = $.NSString.alloc.initWithUTF8String(${JSON.stringify(APP_BUNDLE_ID)});`,
        "const status = $.LSSetDefaultHandlerForURLScheme(scheme, bundle);",
        "if (status !== 0) throw new Error(`LSSetDefaultHandlerForURLScheme failed: ${status}`);",
      ].join(" "),
    ]);
  }
}

// Bundle-internal paths are macOS paths whatever host builds them.
export function resolveMacLauncherIconPaths(runtimeDir, development = isDevelopment) {
  return {
    sourceIconPath: NodePath.join(
      repoRoot,
      "assets",
      development ? "dev" : "prod",
      "app-icon.icon",
    ),
    generatedIconPath: NodePath.posix.join(
      runtimeDir,
      development ? "icon-dev.icns" : "icon-prod.icns",
    ),
    generatedCatalogPath: NodePath.posix.join(
      runtimeDir,
      development ? "icon-dev.car" : "icon-prod.car",
    ),
  };
}

function ensureMacIconAssets(runtimeDir) {
  const paths = resolveMacLauncherIconPaths(runtimeDir);
  const { sourceIconPath, generatedIconPath, generatedCatalogPath } = paths;
  NodeFS.mkdirSync(runtimeDir, { recursive: true });

  if (!NodeFS.existsSync(sourceIconPath)) {
    throw new Error(`Desktop macOS icon source is missing at ${sourceIconPath}`);
  }

  const sourceMtimeMs = Math.max(
    NodeFS.statSync(sourceIconPath).mtimeMs,
    ...NodeFS.readdirSync(sourceIconPath, { recursive: true }).map(
      (relative) => NodeFS.statSync(NodePath.join(sourceIconPath, relative)).mtimeMs,
    ),
  );
  if (
    NodeFS.existsSync(generatedIconPath) &&
    NodeFS.existsSync(generatedCatalogPath) &&
    NodeFS.statSync(generatedIconPath).mtimeMs >= sourceMtimeMs &&
    NodeFS.statSync(generatedCatalogPath).mtimeMs >= sourceMtimeMs
  ) {
    return paths;
  }

  const xcode = NodeChildProcess.spawnSync("xcodebuild", ["-version"], { encoding: "utf8" });
  if (xcode.status !== 0 || !isSupportedXcodeVersion(xcode.stdout)) {
    throw new Error(
      `${XCODE_REQUIREMENT} is required for the macOS desktop launcher. Select full Xcode with DEVELOPER_DIR or xcode-select.\n${[xcode.stdout, xcode.stderr].filter(Boolean).join("\n")}`.trim(),
    );
  }
  const outputDirectory = NodeFS.mkdtempSync(NodePath.join(runtimeDir, "icon-compile-"));
  try {
    runChecked("xcrun", macIconCompilerArguments(sourceIconPath, outputDirectory));
    NodeFS.copyFileSync(NodePath.join(outputDirectory, `${MAC_ICON_NAME}.icns`), generatedIconPath);
    NodeFS.copyFileSync(NodePath.join(outputDirectory, "Assets.car"), generatedCatalogPath);
    return paths;
  } finally {
    NodeFS.rmSync(outputDirectory, { recursive: true, force: true });
  }
}

export function resolveMacBundleInfoPlistStrings(executableName) {
  return {
    CFBundleDisplayName: APP_DISPLAY_NAME,
    CFBundleName: APP_DISPLAY_NAME,
    CFBundleIdentifier: APP_BUNDLE_ID,
    CFBundleExecutable: executableName,
    CFBundleIconFile: "icon.icns",
    CFBundleIconName: MAC_ICON_NAME,
    NSScreenCaptureUsageDescription:
      "Supaterm captures the active window when you use the snapshot shortcut.",
    NSMicrophoneUsageDescription: "Supaterm uses your microphone to dictate messages and commands.",
    NSDocumentsFolderUsageDescription: "Supaterm reads project files you open in the desktop app.",
  };
}

function patchMainBundleInfoPlist(appBundlePath, iconAssets, executableName) {
  const infoPlistPath = NodePath.join(appBundlePath, "Contents", "Info.plist");
  for (const [key, value] of Object.entries(resolveMacBundleInfoPlistStrings(executableName))) {
    setPlistString(infoPlistPath, key, value);
  }
  // macOS 26 offers Messages/Mail codes in every text field unless opted out.
  setPlistJson(infoPlistPath, "NSAutoFillRequiresTextContentTypeForOneTimeCodeOnMac", true);
  setPlistJson(infoPlistPath, "CFBundleURLTypes", [
    {
      CFBundleURLName: APP_BUNDLE_ID,
      CFBundleURLSchemes: APP_PROTOCOL_SCHEMES,
    },
  ]);

  const resourcesDir = NodePath.join(appBundlePath, "Contents", "Resources");
  NodeFS.copyFileSync(iconAssets.generatedIconPath, NodePath.join(resourcesDir, "icon.icns"));
  NodeFS.copyFileSync(iconAssets.generatedIconPath, NodePath.join(resourcesDir, "electron.icns"));
  NodeFS.copyFileSync(iconAssets.generatedCatalogPath, NodePath.join(resourcesDir, "Assets.car"));
}

function patchHelperBundleInfoPlists(appBundlePath) {
  const helperBundleNames = [
    ["Electron Helper.app", "helper", `${APP_DISPLAY_NAME} Helper`],
    ["Electron Helper (GPU).app", "helper.gpu", `${APP_DISPLAY_NAME} Helper (GPU)`],
    ["Electron Helper (Plugin).app", "helper.plugin", `${APP_DISPLAY_NAME} Helper (Plugin)`],
    ["Electron Helper (Renderer).app", "helper.renderer", `${APP_DISPLAY_NAME} Helper (Renderer)`],
  ];

  for (const [bundleName, bundleIdentifierSuffix, bundleDisplayName] of helperBundleNames) {
    const infoPlistPath = NodePath.join(
      appBundlePath,
      "Contents",
      "Frameworks",
      bundleName,
      "Contents",
      "Info.plist",
    );
    if (!NodeFS.existsSync(infoPlistPath)) {
      continue;
    }

    setPlistString(infoPlistPath, "CFBundleDisplayName", bundleDisplayName);
    setPlistString(infoPlistPath, "CFBundleName", bundleDisplayName);
    setPlistString(
      infoPlistPath,
      "CFBundleIdentifier",
      `${APP_BUNDLE_ID}.${bundleIdentifierSuffix}`,
    );
  }
}

function readJson(path) {
  try {
    return JSON.parse(NodeFS.readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

export function resolveMacLauncherPaths(appBundlePath, displayName = APP_DISPLAY_NAME) {
  const executableDir = NodePath.posix.join(appBundlePath, "Contents", "MacOS");
  const launcherExecutableName = `${displayName} Launcher`;
  return {
    launcherExecutableName,
    launcherBinaryPath: NodePath.posix.join(executableDir, launcherExecutableName),
    runtimeElectronBinaryPath: NodePath.posix.join(executableDir, "Electron"),
  };
}

function buildMacLauncher(electronBinaryPath) {
  const sourceAppBundlePath = NodePath.resolve(NodePath.dirname(electronBinaryPath), "../..");
  const runtimeDir = NodePath.join(desktopDir, ".electron-runtime");
  const targetAppBundlePath = NodePath.join(runtimeDir, `${APP_DISPLAY_NAME}.app`);
  const developmentPaths = resolveMacLauncherPaths(targetAppBundlePath);
  const runtimeElectronBinaryPath = developmentPaths.runtimeElectronBinaryPath;
  const launcherBinaryPath = isDevelopment
    ? developmentPaths.launcherBinaryPath
    : runtimeElectronBinaryPath;
  const iconAssets = ensureMacIconAssets(runtimeDir);
  const metadataPath = NodePath.join(runtimeDir, "metadata.json");

  NodeFS.mkdirSync(runtimeDir, { recursive: true });

  const expectedMetadata = {
    launcherVersion: LAUNCHER_VERSION,
    sourceAppBundlePath,
    sourceAppMtimeMs: NodeFS.statSync(sourceAppBundlePath).mtimeMs,
    iconMtimeMs: NodeFS.statSync(iconAssets.generatedIconPath).mtimeMs,
    iconCatalogMtimeMs: NodeFS.statSync(iconAssets.generatedCatalogPath).mtimeMs,
    appBundleId: APP_BUNDLE_ID,
    appProtocolSchemes: APP_PROTOCOL_SCHEMES,
  };

  const currentMetadata = readJson(metadataPath);
  if (
    NodeFS.existsSync(launcherBinaryPath) &&
    (!isDevelopment || NodeFS.existsSync(runtimeElectronBinaryPath)) &&
    currentMetadata &&
    JSON.stringify(currentMetadata) === JSON.stringify(expectedMetadata)
  ) {
    if (isDevelopment) {
      // The launcher also handles protocol activations outside the dev runner,
      // so refresh its fallback environment on every launch. Never let a value
      // captured by an older parent app override the live dev-runner environment.
      writeDevelopmentEnvironmentScript();
      if (writeDevelopmentLauncherScript(launcherBinaryPath, runtimeElectronBinaryPath)) {
        signMacLauncherBundle(targetAppBundlePath);
      }
    }
    registerMacLauncherBundle(targetAppBundlePath);
    return launcherBinaryPath;
  }

  NodeFS.rmSync(targetAppBundlePath, { recursive: true, force: true });
  // verbatimSymlinks keeps the framework's relative symlinks intact
  // (e.g. Resources -> Versions/Current/Resources). Without it cpSync
  // rewrites them to absolute paths into node_modules, which escape the
  // bundle and crash sandboxed helper processes (icudtl.dat not found).
  NodeFS.cpSync(sourceAppBundlePath, targetAppBundlePath, {
    recursive: true,
    verbatimSymlinks: true,
  });
  patchMainBundleInfoPlist(
    targetAppBundlePath,
    iconAssets,
    isDevelopment ? developmentPaths.launcherExecutableName : "Electron",
  );
  patchHelperBundleInfoPlists(targetAppBundlePath);
  if (isDevelopment) {
    // Launching the node_modules copy makes macOS associate the process (and Dock label) with
    // Electron.app even though this bundle's Info.plist has the Supaterm name. Its conventional
    // executable name also keeps Electron's default-app runtime in development mode instead of
    // making app.isPackaged report true.
    writeDevelopmentEnvironmentScript();
    writeDevelopmentLauncherScript(launcherBinaryPath, runtimeElectronBinaryPath);
  }
  signMacLauncherBundle(targetAppBundlePath);
  NodeFS.writeFileSync(metadataPath, `${JSON.stringify(expectedMetadata, null, 2)}\n`);
  registerMacLauncherBundle(targetAppBundlePath);

  return launcherBinaryPath;
}

function isLinuxSetuidSandboxConfigured(electronBinaryPath) {
  if (hostPlatform !== "linux") {
    return true;
  }

  const sandboxPath = NodePath.join(NodePath.dirname(electronBinaryPath), "chrome-sandbox");
  try {
    const sandboxStat = NodeFS.statSync(sandboxPath);
    return sandboxStat.uid === 0 && (sandboxStat.mode & 0o4777) === 0o4755;
  } catch {
    return false;
  }
}

function resolveLinuxSandboxArgs(electronBinaryPath) {
  if (isLinuxSetuidSandboxConfigured(electronBinaryPath)) {
    return [];
  }

  console.warn(
    "[desktop-launcher] Electron chrome-sandbox is not root-owned with mode 4755; launching local Electron with --no-sandbox.",
  );
  return ["--no-sandbox"];
}

function resolveElectronPath() {
  const electronBinaryPath = resolveElectronBinaryPath();

  if (hostPlatform !== "darwin") {
    return electronBinaryPath;
  }

  return buildMacLauncher(electronBinaryPath);
}

export function resolveElectronLaunchCommand(args = []) {
  const electronPath = resolveElectronPath();
  return {
    electronPath,
    args: [...resolveLinuxSandboxArgs(electronPath), ...args],
  };
}

export function resolveElectronBinaryPath({
  ensureRuntime = ensureElectronRuntime,
  createRequire = NodeModule.createRequire,
  moduleUrl = import.meta.url,
} = {}) {
  ensureRuntime();

  const require = createRequire(moduleUrl);
  return require("electron");
}

export function resolveDevProtocolClient() {
  if (hostPlatform !== "darwin" || !isDevelopment) {
    return null;
  }

  const electronBinaryPath = resolveElectronBinaryPath();
  const launcherBinaryPath = buildMacLauncher(electronBinaryPath);
  return {
    appBundlePath: NodePath.resolve(launcherBinaryPath, "..", "..", ".."),
    appBundleId: APP_BUNDLE_ID,
  };
}
