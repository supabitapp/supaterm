// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalTimers:off
// Runs CI's fast checks for this branch's changes: format and lint of the
// changed files, knip, generated GraphQL operations, rendered icon inputs,
// typecheck of the affected packages and their dependents, the test files
// beside the changed files, and the cross-file checks those miss (agent context
// budget, React Compiler coverage of the changed client files). A dependency
// change also gets the unused-patch install check below. CI still runs the full
// test suites and the jobs listed in the summary.
//
//   vp run check:changed                  compare against the merge base with origin/main
//   vp run check:changed <ref>            compare against the merge base with <ref>
//   vp run check:changed --concurrency 1  run the steps one at a time
//
// Uncommitted and untracked files count. Affected packages come from
// scripts/lib/changed-packages.ts.
// The steps run side by side within a budget derived from the machine's cores
// and available memory, and each prints its output when it finishes. A step
// running past the timeout is killed with every process it started and reported as
// TIMEOUT. A rerun on exactly the files of the last passing run prints that
// run's summary.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { affectedPackages, readWorkspace } from "./lib/changed-packages.ts";

const root = NodePath.resolve(import.meta.dirname, "..");
const CODE = /\.[cm]?[jt]sx?$/;

// Mirrors the mobile_native_changes gate in .github/workflows/ci.yml.
const MOBILE_NATIVE =
  /^apps\/mobile\/.*\.(swift|kt|kts)$|^apps\/mobile\/(\.swiftlint\.yml|detekt\.yml|\.editorconfig|Brewfile)$|^scripts\/mobile-native-static-check\.ts$|^package\.json$|^\.github\/workflows\/ci\.yml$/;

// quotePath=false keeps non-ASCII paths as real paths instead of quoted escapes.
const git = (...args: Array<string>) =>
  NodeChildProcess.execFileSync("git", ["-c", "core.quotePath=false", ...args], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\n")
    .filter(Boolean);

const USAGE = "usage: vp run check:changed [<ref>] [--concurrency <n>] [--timeout <seconds>]";
const positiveInt = (name: string, value: string | undefined) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    console.error(`check:changed: ${name} must be a positive integer.\n${USAGE}`);
    process.exit(1);
  }
  return parsed;
};
const flags = new Map<string, string | undefined>();
const positional: Array<string> = [];
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index]!;
  const [name, inline] = arg.split("=", 2) as [string, string | undefined];
  if (name === "--concurrency" || name === "--timeout") {
    flags.set(name, inline ?? process.argv[++index]);
  } else if (arg.startsWith("-")) {
    console.error(`check:changed: unknown option ${arg}.\n${USAGE}`);
    process.exit(1);
  } else {
    positional.push(arg);
  }
}
// A flag wins over its environment variable.
const override = (flag: string, envName: string) =>
  flags.has(flag)
    ? positiveInt(flag, flags.get(flag))
    : process.env[envName] === undefined
      ? undefined
      : positiveInt(envName, process.env[envName]);

const GiB = 1024 ** 3;
// A typecheck or test step can take several cores and gigabytes of memory, so
// allow one step per two cores and per 6 GiB of available memory. macOS counts
// its file cache as used, so its total memory stands in for available memory;
// elsewhere availableMemory() honors a cgroup limit.
const concurrency =
  override("--concurrency", "CHECK_CHANGED_CONCURRENCY") ??
  Math.max(
    1,
    Math.min(
      Math.floor(NodeOS.availableParallelism() / 2),
      Math.floor(
        // oxlint-disable-next-line supaterm/no-global-process-runtime -- This script runs without an Effect runtime.
        (NodeOS.platform() === "darwin" ? NodeOS.totalmem() : process.availableMemory()) /
          (6 * GiB),
      ),
    ),
  );
const timeoutSeconds = override("--timeout", "CHECK_CHANGED_TIMEOUT") ?? 900;

const ref = positional[0] ?? "origin/main";
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
console.log(`check:changed: ${files.length} files since ${base.slice(0, 12)}`);

// Ignored generated sources, declarations, env files, and install state affect check results.
// Include them in the key, but skip large ignored folders that no check reads.
// Recompute after a passing run so edits made during it are never cached as passing.
const inputKey = () => {
  const hash = NodeCrypto.createHash("sha256");
  // CI changes test behavior (vite.config.ts rejects .only under CI).
  hash.update(`${process.version}\0${base}\0${process.env.CI ?? ""}\0`);
  hash.update(
    NodeChildProcess.execFileSync(
      "git",
      ["diff", "--binary", "--no-renames", "--no-ext-diff", "--no-textconv", base, "--"],
      { cwd: root, maxBuffer: 1024 * 1024 * 1024 },
    ),
  );
  const ignored = git(
    "ls-files",
    "--others",
    "--ignored",
    "--exclude-standard",
    "--",
    ":(glob)**/.generated/**",
    ":(glob)**/.astro/**",
    ":(glob)**/*.d.ts",
    ":(glob)**/.env*",
    ":(exclude,glob)**/node_modules/**",
  );
  for (const file of [
    // Raw bytes of changed files too: .gitattributes normalizes line endings in
    // the diff, but the formatter reads the file as it is on disk.
    ...git("diff", "--name-only", "--no-renames", base, "--"),
    ...git("ls-files", "--others", "--exclude-standard"),
    ...ignored,
    "node_modules/.modules.yaml",
    "node_modules/.pnpm/lock.yaml",
  ]) {
    hash.update(`\0${file}\0`);
    const path = NodePath.join(root, file);
    // Untracked nested repositories are listed as directories.
    if (NodeFS.statSync(path, { throwIfNoEntry: false })?.isFile()) {
      hash.update(NodeFS.readFileSync(path));
    }
  }
  return hash.digest("hex");
};
const key = inputKey();
const cachePath = NodePath.join(root, "node_modules/.cache/check-changed.json");
// A missing or unreadable cache is a miss, never a failure.
const readCache = () => {
  try {
    return JSON.parse(NodeFS.readFileSync(cachePath, "utf8")) as {
      key: string;
      summary: Array<string>;
    };
  } catch {
    return undefined;
  }
};
const cached = readCache();
if (cached?.key === key) {
  console.log("Nothing changed since the last passing run.\n");
  for (const line of cached.summary) console.log(line);
  process.exit(0);
}

const present = files.filter((file) => NodeFS.existsSync(NodePath.join(root, file)));
const code = present.filter((file) => CODE.test(file));
const packages = readWorkspace(root);
const { affected, everything } = affectedPackages(files, packages);

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
// It reads files other than the ones beside it, so no changed file selects it.
if (affected.includes("supaterm")) tests.add("apps/server/src/provider/AgentContextBudget.test.ts");

// React Compiler coverage compiles every client source file, so run only the
// changed files' cases, in one extra step: a -t filter in the main test step
// would drop every other test. Coverage files the main step already runs
// unfiltered are left out. File filters mirror each coverage test.
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const compilerApps = [
  {
    root: "apps/web/src/",
    // Test names keep the repo-relative path.
    name: (file: string) => file,
    compiled: (file: string) =>
      /\.tsx?$/.test(file) && !/\.(test|browser)\.tsx?$/.test(file) && !file.endsWith(".gen.ts"),
    // Web has only per-file cases.
    always: [],
  },
  {
    root: "apps/mobile/src/",
    name: (file: string) => file.slice("apps/mobile/".length),
    compiled: (file: string) => /\.tsx?$/.test(file) && !/\.(test\.tsx?|d\.ts)$/.test(file),
    // The Metro, cache, and stale-allowlist cases check more than one file, deletions included.
    always: ["^(?!.*compiles )"],
  },
].flatMap(({ root: appRoot, name, compiled, always }) => {
  const changed = files.filter((file) => file.startsWith(appRoot) && compiled(file));
  // Mobile splits its per-file cases across sweep files beside the main coverage test.
  const coverage = NodeFS.readdirSync(NodePath.join(root, appRoot))
    .filter((entry) => /^reactCompilerCoverage.*\.test\.ts$/.test(entry))
    .map((entry) => `${appRoot}${entry}`)
    .filter((test) => !tests.has(test));
  if (changed.length === 0 || coverage.length === 0) return [];
  const names = changed.flatMap((file) =>
    present.includes(file) ? [`compiles ${escapeRegExp(name(file))}$`] : [],
  );
  const pattern = [...names, ...always];
  return pattern.length > 0 ? [{ coverage, names, pattern }] : [];
});
const compilerCoverage = compilerApps.length > 0 && {
  name: `react compiler (${compilerApps.reduce((count, app) => count + app.names.length, 0)} files)`,
  args: [
    "test",
    "run",
    ...compilerApps.flatMap((app) => app.coverage),
    "-t",
    compilerApps.flatMap((app) => app.pattern).join("|"),
  ],
};

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
// CI runs knip:check as one script of `knip ... && knip ...` passes. The passes
// do not depend on each other, so they run side by side here.
const knipCheck: string = JSON.parse(
  NodeFS.readFileSync(NodePath.join(root, "package.json"), "utf8"),
).scripts["knip:check"];
const knipPasses = knipCheck.split(" && ").map((command, index, all) => {
  const [bin, ...args] = command.trim().split(/\s+/);
  if (bin !== "knip" || /["'$\\|;&<>]/.test(command)) {
    throw new Error(`check:changed cannot split knip:check: ${command}`);
  }
  return { name: `knip ${index + 1}/${all.length}`, args: ["exec", "knip", ...args] };
});

// A version bump can leave a patch unused, causing pnpm to reject the install
// with ERR_PNPM_UNUSED_PATCH. Check it here as Release Smoke does in CI.
const runPatchCheck = files.some(
  (file) =>
    file === "pnpm-workspace.yaml" ||
    file === "pnpm-lock.yaml" ||
    file === ".pnpmfile.cjs" ||
    file.startsWith("patches/") ||
    file.startsWith("apps/mobile/deps/") ||
    NodePath.basename(file) === "package.json",
);

// Output is piped, so keep the colors a terminal would get.
const env = process.stdout.isTTY ? { ...process.env, FORCE_COLOR: "1" } : process.env;
type Outcome = "pass" | "FAIL" | "TIMEOUT";
type StepResult = { readonly outcome: Outcome; readonly output: Buffer };
// Its own process group, so a timeout kills every process the step started.
const spawnStep = (command: string, args: ReadonlyArray<string>, cwd: string, deadline: number) =>
  new Promise<StepResult>((resolve) => {
    const output: Array<Buffer> = [];
    const child = NodeChildProcess.spawn(command, args, { cwd, env, detached: true });
    const timer = setTimeout(
      () => {
        try {
          // Windows rejects process-group signals; taskkill /T reaps the tree.
          // oxlint-disable-next-line supaterm/no-global-process-runtime -- This script runs without an Effect runtime.
          if (NodeOS.platform() === "win32") {
            NodeChildProcess.spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
              stdio: "ignore",
            });
          } else if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
        // A surviving descendant can hold the pipes open, so "close" may never come.
        child.stdout.destroy();
        child.stderr.destroy();
        child.unref();
        resolve({ outcome: "TIMEOUT", output: Buffer.alloc(0) });
      },
      Math.max(0, deadline - performance.now()),
    );
    child.stdout.on("data", (chunk: Buffer) => output.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => output.push(chunk));
    // A failed spawn emits "error", then "close" with a nonzero code.
    child.on("error", (error) => output.push(Buffer.from(`${error.message}\n`)));
    child.on("close", (status) => {
      clearTimeout(timer);
      resolve({ outcome: status === 0 ? "pass" : "FAIL", output: Buffer.concat(output) });
    });
  });

// Resolve without the lockfile in a temp copy to preserve the working tree and lockfile.
// Copy mobile modules too: they are file: dependencies, not workspace packages.
// Cached registry metadata limits this to patches stranded by local changes, not registry drift.
const checkPatches = async (deadline: number): Promise<StepResult> => {
  const temp = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "supaterm-patch-check-"));
  try {
    const copy = (relative: string) => {
      const dest = NodePath.join(temp, relative);
      NodeFS.mkdirSync(NodePath.dirname(dest), { recursive: true });
      NodeFS.cpSync(NodePath.join(root, relative), dest, { recursive: true });
    };
    copy("package.json");
    copy("pnpm-workspace.yaml");
    for (const pkg of packages) copy(`${pkg.dir}/package.json`);
    const modulesDir = NodePath.join(root, "apps/mobile/modules");
    if (NodeFS.existsSync(modulesDir)) {
      for (const entry of NodeFS.readdirSync(modulesDir)) {
        const manifest = `apps/mobile/modules/${entry}/package.json`;
        if (NodeFS.existsSync(NodePath.join(root, manifest))) copy(manifest);
      }
    }
    for (const extra of ["apps/mobile/deps", "patches", ".pnpmfile.cjs"]) {
      if (NodeFS.existsSync(NodePath.join(root, extra))) copy(extra);
    }
    const result = await spawnStep(
      "vp",
      ["install", "--lockfile-only", "--ignore-scripts"],
      temp,
      deadline,
    );
    if (result.outcome !== "FAIL" || !result.output.includes("ERR_PNPM_UNUSED_PATCH")) {
      return result;
    }
    const hint =
      "Unused dependency patches: remove each patch named above from " +
      "patchedDependencies in pnpm-workspace.yaml and from patches/, " +
      "update it to the version the install resolves, " +
      "or pin the dependency that pulls it in to the patched version.\n";
    return { outcome: "FAIL", output: Buffer.concat([result.output, Buffer.from(hint)]) };
  } finally {
    NodeFS.rmSync(temp, { recursive: true, force: true });
  }
};

// Generated GraphQL operations must match their sources.
const graphql = ["apps/server", "packages/source-control-github"].filter((dir) =>
  files.some((file) => file.startsWith(`${dir}/`)),
);

// The committed icons are rendered from the bolt computer and its appearance settings.
const iconInputs = files.some(
  (file) => file.startsWith("apps/marketing/src/lib/boltComputer/") || file.startsWith("assets/"),
);

const filters = (names: ReadonlyArray<string>) => names.flatMap((name) => ["--filter", name]);
const typecheckWorkers = Math.min(concurrency, affected.length);
const steps = [
  // Runs first; it takes about a second.
  runPatchCheck && { name: "unused patches", run: checkPatches },
  present.length > 0 && {
    name: "format",
    args: ["fmt", "--check", "--no-error-on-unmatched-pattern", ...present],
  },
  code.length > 0 && { name: "lint", args: ["lint", ...code] },
  ...(runKnip ? knipPasses : []),
  ...graphql.map((dir) => ({
    name: `graphql (${dir})`,
    args: ["run", "--filter", `./${dir}`, "generate", "--check"],
  })),
  iconInputs && { name: "icon inputs", args: ["run", "icons:check-inputs"] },
  affected.length > 0 && {
    name: `typecheck (${affected.length} packages${everything ? ", all" : ""})`,
    // `tsc --noEmit` writes nothing another package reads, so dependency order
    // only made dependents wait: --parallel cut a contracts change from 13 s to 9 s.
    args: [
      "run",
      "--cache",
      "--parallel",
      "--concurrency-limit",
      String(typecheckWorkers),
      ...filters(affected),
      "typecheck",
    ],
    // Budget slots the step holds: one per worker it runs in parallel.
    weight: typecheckWorkers,
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
  compilerCoverage,
].filter((step) => step !== false);

const runStep = async (step: (typeof steps)[number]) => {
  const started = performance.now();
  const deadline = started + timeoutSeconds * 1000;
  const { outcome, output } =
    "run" in step
      ? await step.run(deadline)
      : await spawnStep(
          "command" in step && step.command ? step.command : "vp",
          step.args,
          root,
          deadline,
        );
  const time =
    outcome === "TIMEOUT"
      ? `killed after ${timeoutSeconds}s`
      : `${((performance.now() - started) / 1000).toFixed(1)}s`;
  console.log(`\n> vp ${step.name}  ${outcome}  ${time}`);
  if (output.length > 0) process.stdout.write(output);
  return { name: step.name, outcome, time };
};

// Steps claim budget in order, so a light step cannot take free slots ahead of
// a waiting heavier one, which would delay typecheck.
let freeSlots = concurrency;
const waiting: Array<{ readonly slots: number; readonly start: () => void }> = [];
const admit = () => {
  while (waiting.length > 0 && waiting[0]!.slots <= freeSlots) {
    const next = waiting.shift()!;
    freeSlots -= next.slots;
    next.start();
  }
};
const runWithinBudget = (step: (typeof steps)[number]) => {
  const slots = Math.min("weight" in step && step.weight ? step.weight : 1, concurrency);
  return new Promise<void>((start) => {
    waiting.push({ slots, start });
    admit();
  })
    .then(() => runStep(step))
    .finally(() => {
      freeSlots += slots;
      admit();
    });
};

// Vitest runs started together race to rebuild node_modules/.vitest-cache after
// an install (ENOTEMPTY), so they run one after another.
let previousVitest: Promise<unknown> = Promise.resolve();
const results = await Promise.all(
  steps.map((step) => {
    if (!("args" in step) || step.args[0] !== "test") return runWithinBudget(step);
    const result = previousVitest.then(() => runWithinBudget(step));
    previousVitest = result;
    return result;
  }),
);

const summary = ["check:changed summary"];
for (const result of results) {
  summary.push(`  ${result.outcome}  ${result.name}  ${result.time}`);
}
if (results.some((result) => result.outcome === "TIMEOUT")) {
  summary.push(
    `  TIMEOUT: ran past ${timeoutSeconds}s and was killed; this is not a check failure. ` +
      "Raise --timeout or lower --concurrency.",
  );
}
const ciOnly = [
  "full test suites",
  "build",
  "rust",
  "release smoke",
  ...(files.some((file) => MOBILE_NATIVE.test(file)) ? ["mobile native lint"] : []),
];
summary.push(`  CI also runs: ${ciOnly.join(", ")}`);
if (!runPatchCheck) summary.push("  unused patch check skipped: no dependency files changed");
if (!runKnip) summary.push("  knip skipped: no code or manifest changed");
console.log(`\n${summary.join("\n")}`);
// exitCode, not exit(): piped stdout is asynchronous on macOS, and exit()
// would cut off a failing step's output.
if (results.some((result) => result.outcome !== "pass")) {
  process.exitCode = 1;
} else if (inputKey() !== key) {
  console.log("  pass not cached: files changed during the run");
} else {
  try {
    // Write then rename, so a concurrent run never reads half a file.
    const temp = `${cachePath}.${process.pid}`;
    NodeFS.mkdirSync(NodePath.dirname(cachePath), { recursive: true });
    NodeFS.writeFileSync(temp, JSON.stringify({ key, summary }));
    NodeFS.renameSync(temp, cachePath);
  } catch (error) {
    console.warn(`  pass not cached: ${error instanceof Error ? error.message : String(error)}`);
  }
}
