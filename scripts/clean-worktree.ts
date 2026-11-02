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

const worktree = NodeChildProcess.execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();

// A linked worktree's .git is a file; the main checkout's is a directory.
// oxlint-disable-next-line supaterm/no-global-process-runtime -- Standalone project script has no Effect runtime.
if (NodeFS.statSync(NodePath.join(worktree, ".git")).isFile() && process.platform !== "win32") {
  // Devices named `<purpose>__<worktree directory>` belong to this worktree (see test-supaterm-mobile).
  const worktreeName = NodePath.basename(worktree);
  const isOwned = (deviceName: string) => /^.+?__(.+)$/.exec(deviceName)?.[1] === worktreeName;
  deleteIosSimulators(isOwned);
  deleteAndroidVirtualDevices(isOwned);
}

function deleteIosSimulators(isOwned: (deviceName: string) => boolean) {
  const list = NodeChildProcess.spawnSync("xcrun", ["simctl", "list", "devices", "--json"], {
    encoding: "utf8",
  });
  if (list.status !== 0) return;
  const { devices }: { devices: Record<string, ReadonlyArray<{ udid: string; name: string }>> } =
    JSON.parse(list.stdout);
  for (const device of Object.values(devices).flat()) {
    if (!isOwned(device.name)) continue;
    console.log(`Deleting iOS simulator ${device.name}`);
    NodeChildProcess.execFileSync("xcrun", ["simctl", "delete", device.udid], { stdio: "inherit" });
  }
}

function deleteAndroidVirtualDevices(isOwned: (deviceName: string) => boolean) {
  const homes = process.env.ANDROID_AVD_HOME
    ? [process.env.ANDROID_AVD_HOME]
    : [
        NodePath.join(NodeOS.homedir(), ".android", "avd"),
        NodePath.join(NodeOS.homedir(), ".config", ".android", "avd"),
      ];
  const realHomes = new Set(
    homes.filter((home) => NodeFS.existsSync(home)).map((home) => NodeFS.realpathSync(home)),
  );
  for (const home of realHomes) {
    for (const file of NodeFS.readdirSync(home)) {
      const name = NodePath.basename(file, ".ini");
      if (file.endsWith(".ini") && isOwned(name)) deleteAndroidVirtualDevice(home, name);
    }
  }
}

function deleteAndroidVirtualDevice(home: string, name: string) {
  const ini = NodePath.join(home, `${name}.ini`);
  const recordedPath = /^path=(.+?)\r?$/m.exec(NodeFS.readFileSync(ini, "utf8"))?.[1] ?? "";
  const directories = [NodePath.join(home, `${name}.avd`), recordedPath].filter(
    (directory) => NodePath.isAbsolute(directory) && NodePath.basename(directory) === `${name}.avd`,
  );
  const processes = NodeChildProcess.execFileSync("ps", ["-axo", "args="], { encoding: "utf8" });
  const running =
    processes.includes(`-avd ${name}`) ||
    processes.includes(`@${name}`) ||
    directories.some((directory) =>
      NodeFS.existsSync(NodePath.join(directory, "hardware-qemu.ini.lock")),
    );
  if (running) {
    console.log(`Skipping Android emulator ${name}: it is running. Stop it and run this again.`);
    return;
  }
  console.log(`Deleting Android emulator ${name}`);
  for (const directory of directories) NodeFS.rmSync(directory, { recursive: true, force: true });
  NodeFS.rmSync(ini, { force: true });
}
