// @effect-diagnostics nodeBuiltinImport:off - runs before `vp i`, so only Node built-ins exist.

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const projectRoot = process.env.SUPATERM_PROJECT_ROOT;
if (!projectRoot) {
  throw new Error(
    "SUPATERM_PROJECT_ROOT is not set. Run this through the supaterm.json setup action.",
  );
}
const worktree = NodePath.dirname(import.meta.dirname);

const unattended: NodeChildProcess.StdioOptions = ["ignore", "inherit", "inherit"];

const miseInstall = NodeChildProcess.spawnSync("mise", ["install"], {
  cwd: worktree,
  stdio: unattended,
});
if (miseInstall.status !== 0) process.exit(miseInstall.status ?? 1);

const install = NodeChildProcess.spawnSync(
  "mise",
  ["exec", "--", "vp", "i", "--frozen-lockfile", "--", "--yes"],
  { cwd: worktree, stdio: unattended },
);
if (install.status !== 0) process.exit(install.status ?? 1);

const ENV_FILES = [".env"];
for (const file of ENV_FILES) {
  const source = NodePath.join(projectRoot, file);
  const sourceStat = NodeFS.lstatSync(source, { throwIfNoEntry: false });
  if (!sourceStat) continue;
  if (!sourceStat.isFile()) {
    process.stderr.write(`Skipping ${file}: ${source} is not a regular file.\n`);
    continue;
  }
  const target = NodePath.join(worktree, file);
  const existing = NodeFS.lstatSync(target, { throwIfNoEntry: false });
  if (existing && !existing.isSymbolicLink()) continue;
  if (existing) NodeFS.rmSync(target);
  NodeFS.symlinkSync(source, target);
}
