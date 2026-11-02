// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - runs as a plain Node project script.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

const preservedPaths = [
  "**/node_modules/",
  "**/node_modules/**",
  "**/.pnpm-store/",
  "**/.pnpm-store/**",
  "**/.env",
  "**/.env.*",
  "**/.supaterm/",
  "**/.supaterm/**",
  "**/.supacode/",
  "**/.supacode/**",
  "**/*.pem",
  "**/*.local",
  "**/.dev.vars*",
  "**/.mise/ports.env*",
  "**/fnox.local.toml",
  "**/fnox.*.local.toml",
];

const args = ["clean", "-fdX", ...preservedPaths.flatMap((path) => ["-e", `!${path}`])];

NodeChildProcess.execFileSync("git", args, { stdio: "inherit" });

const git = (...gitArgs: ReadonlyArray<string>) =>
  NodeChildProcess.execFileSync("git", gitArgs, { encoding: "utf8" }).trim();

const [gitDir, commonDir] = git(
  "rev-parse",
  "--path-format=absolute",
  "--git-dir",
  "--git-common-dir",
).split("\n");

// Devices named `<purpose>-<worktree directory>` belong to this worktree (see test-supaterm-mobile).
// oxlint-disable-next-line supaterm/no-global-process-runtime -- Standalone project script has no Effect runtime.
if (gitDir !== commonDir && process.platform !== "win32") {
  const ownedSuffix = `-${NodePath.basename(git("rev-parse", "--show-toplevel"))}`;
  deleteIosSimulators(ownedSuffix);
  deleteAndroidVirtualDevices(ownedSuffix);
}

function deleteIosSimulators(ownedSuffix: string) {
  const list = NodeChildProcess.spawnSync("xcrun", ["simctl", "list", "devices", "--json"], {
    encoding: "utf8",
  });
  if (list.status !== 0) return;
  const { devices }: { devices: Record<string, ReadonlyArray<{ udid: string; name: string }>> } =
    JSON.parse(list.stdout);
  for (const device of Object.values(devices).flat()) {
    if (!device.name.endsWith(ownedSuffix)) continue;
    console.log(`Deleting iOS simulator ${device.name}`);
    NodeChildProcess.execFileSync("xcrun", ["simctl", "delete", device.udid], { stdio: "inherit" });
  }
}

function deleteAndroidVirtualDevices(ownedSuffix: string) {
  const avdHomes = process.env.ANDROID_AVD_HOME
    ? [process.env.ANDROID_AVD_HOME]
    : [
        NodePath.join(NodeOS.homedir(), ".android", "avd"),
        NodePath.join(NodeOS.homedir(), ".config", ".android", "avd"),
      ];
  const owned = avdHomes
    .filter((home) => NodeFS.existsSync(home))
    .flatMap((home) =>
      NodeFS.readdirSync(home)
        .filter((file) => file.endsWith(`${ownedSuffix}.ini`))
        .map((file) => NodePath.join(home, file)),
    );
  if (owned.length === 0) return;
  const processes = NodeChildProcess.execFileSync("ps", ["-axo", "args="], { encoding: "utf8" });
  for (const ini of owned) {
    const name = NodePath.basename(ini, ".ini");
    if (processes.includes(`-avd ${name}`) || processes.includes(`@${name}`)) {
      console.log(`Skipping Android emulator ${name}: it is running. Stop it and run this again.`);
      continue;
    }
    console.log(`Deleting Android emulator ${name}`);
    const avdPath = /^path=(.+)$/m.exec(NodeFS.readFileSync(ini, "utf8"))?.[1];
    if (avdPath) NodeFS.rmSync(avdPath, { recursive: true, force: true });
    NodeFS.rmSync(ini);
  }
}
