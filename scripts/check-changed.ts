// @effect-diagnostics nodeBuiltinImport:off globalConsole:off
// Runs CI's fast checks for this branch's changes: format and lint of the
// changed files, knip, generated GraphQL operations, typecheck of the affected
// packages and their dependents, and the test files beside the changed files.
// CI still runs the full test suites and the jobs listed in the summary.
//
//   vp run check:changed          compare against the merge base with origin/main
//   vp run check:changed <ref>    compare against the merge base with <ref>
//
// Uncommitted and untracked files count. Affected packages come from
// scripts/lib/changed-packages.ts.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { affectedPackages, readWorkspace } from "./lib/changed-packages.ts";

const root = NodePath.resolve(import.meta.dirname, "..");
const CODE = /\.[cm]?[jt]sx?$/;

// Mirrors the mobile_native_changes gate in .github/workflows/ci.yml.
const MOBILE_NATIVE =
  /^apps\/mobile\/.*\.(swift|kt|kts)$|^apps\/mobile\/(\.swiftlint\.yml|detekt\.yml|\.editorconfig|Brewfile)$|^scripts\/mobile-native-static-check\.ts$|^package\.json$|^\.github\/workflows\/ci\.yml$/;

const git = (...args: Array<string>) =>
  NodeChildProcess.execFileSync("git", args, { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);

const ref = process.argv[2] ?? "origin/main";
const mergeBase = NodeChildProcess.spawnSync("git", ["merge-base", "HEAD", ref], {
  cwd: root,
  encoding: "utf8",
});
if (mergeBase.status !== 0) {
  console.error(
    `check:changed: no merge base with ${ref}. Run \`git fetch origin\` or pass a ref.`,
  );
  process.exit(1);
}
const base = mergeBase.stdout.trim();
// --no-renames lists a rename as its old and new path.
const untracked = git("ls-files", "--others", "--exclude-standard");
const files = [
  ...new Set([...git("diff", "--name-only", "--no-renames", base, "--"), ...untracked]),
].toSorted();

if (files.length === 0) {
  console.log(`check:changed: no changes since ${base.slice(0, 12)}.`);
  process.exit(0);
}

const present = files.filter((file) => NodeFS.existsSync(NodePath.join(root, file)));
const code = present.filter((file) => CODE.test(file));
const { affected, everything } = affectedPackages(files, readWorkspace(root));

// Changed test files, and the test files beside a changed source file
// (foo.ts -> foo.test.ts, foo.browser.test.tsx). Vitest's import-graph
// `related` reaches most of a package: one leaf server file pulled in 252 of
// 406 server test files and took 7 minutes. CI runs the rest.
const TEST = /\.test\.[cm]?[jt]sx?$/;
const tests = new Set(code.filter((file) => TEST.test(file)));
for (const file of code) {
  const dir = NodePath.dirname(file);
  const prefix = `${NodePath.basename(file).replace(CODE, "")}.`;
  for (const entry of NodeFS.readdirSync(NodePath.join(root, dir))) {
    if (entry.startsWith(prefix) && TEST.test(entry)) tests.add(NodePath.join(dir, entry));
  }
}

// Suites written for `node --test` register nothing with Vitest, which then fails them.
const nodeTests = [...tests].filter((file) =>
  /from ["']node:test["']/.test(NodeFS.readFileSync(NodePath.join(root, file), "utf8")),
);
const vitestTests = [...tests].filter((file) => !nodeTests.includes(file));

// knip:check cannot be scoped to a package. Any code change can leave a file,
// export, or dependency unused (removing the last import of a helper does), so
// it runs whenever code or a manifest changes.
const runKnip = files.some(
  (file) => CODE.test(file) || NodePath.basename(file) === "package.json" || file === "knip.jsonc",
);

// Generated GraphQL operations must match their sources.
const graphql = ["apps/server", "packages/source-control-github"].filter((dir) =>
  files.some((file) => file.startsWith(`${dir}/`)),
);

const filters = (names: ReadonlyArray<string>) => names.flatMap((name) => ["--filter", name]);
const steps = [
  present.length > 0 && {
    name: "format",
    args: ["fmt", "--check", "--no-error-on-unmatched-pattern", ...present],
  },
  code.length > 0 && { name: "lint", args: ["lint", ...code] },
  runKnip && { name: "knip", args: ["run", "knip:check"] },
  ...graphql.map((dir) => ({
    name: `graphql (${dir})`,
    args: ["run", "--filter", `./${dir}`, "generate", "--check"],
  })),
  affected.length > 0 && {
    name: `typecheck (${affected.length} packages${everything ? ", all" : ""})`,
    args: ["run", "--cache", "--concurrency-limit", "4", ...filters(affected), "typecheck"],
  },
  // From the repo root, the root vite.config.ts hands each file to its package's config.
  vitestTests.length > 0 && {
    name: `test (${vitestTests.length} files)`,
    args: ["test", "run", "--passWithNoTests", ...vitestTests],
  },
  nodeTests.length > 0 && {
    name: `test (${nodeTests.length} node:test files)`,
    command: "node",
    args: ["--test", ...nodeTests],
  },
].filter((step) => step !== false);

console.log(`check:changed: ${files.length} files since ${base.slice(0, 12)}`);
const results = steps.map((step) => {
  const command = step.command ?? "vp";
  console.log(`\n> ${command} ${step.name}`);
  const started = performance.now();
  const { status } = NodeChildProcess.spawnSync(command, step.args, {
    cwd: root,
    stdio: "inherit",
  });
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  return { name: step.name, ok: status === 0, seconds };
});

console.log("\ncheck:changed summary");
for (const result of results) {
  console.log(`  ${result.ok ? "pass" : "FAIL"}  ${result.name}  ${result.seconds}s`);
}
const ciOnly = [
  "full test suites",
  "build",
  "rust",
  "release smoke",
  ...(files.some((file) => MOBILE_NATIVE.test(file)) ? ["mobile native lint"] : []),
];
console.log(`  CI also runs: ${ciOnly.join(", ")}`);
if (!runKnip) console.log("  knip skipped: no code or manifest changed");
if (results.some((result) => !result.ok)) process.exit(1);
