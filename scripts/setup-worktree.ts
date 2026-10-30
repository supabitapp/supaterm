// @effect-diagnostics nodeBuiltinImport:off - runs before `vp i`, so only Node built-ins exist.
/**
 * Run by the supaterm.json "Setup Worktree" action. Plain Node keeps one command working in every
 * shell Supaterm spawns (zsh, bash, fish, PowerShell).
 */
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

// Setup has no one answering install prompts. Leave stdin closed so prompts
// fail instead of hanging.
const unattended: NodeChildProcess.StdioOptions = ["ignore", "inherit", "inherit"];

const miseInstall = NodeChildProcess.spawnSync("mise", ["install"], {
  cwd: worktree,
  stdio: unattended,
});
if (miseInstall.status !== 0) process.exit(miseInstall.status ?? 1);

// `-- --yes` passes pnpm's confirmation flag through vp.
// Install exactly the locked dependencies so setup never rewrites the lockfile.
// A stale lockfile must fail setup rather than silently resolving a new one.
const install = NodeChildProcess.spawnSync(
  "mise",
  ["exec", "--", "vp", "i", "--frozen-lockfile", "--", "--yes"],
  { cwd: worktree, stdio: unattended },
);
if (install.status !== 0) process.exit(install.status ?? 1);

// Env files live as real files in the main checkout; worktrees only get
// symlinks to them. Only a symlink is ever replaced, so a real env file is
// never deleted, including when this runs in the main checkout itself.
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
