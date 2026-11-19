// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalTimers:off
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { vitePlusCommand } from "./check-changed-command.ts";
import { affectedPackages, readWorkspace } from "./lib/changed-packages.ts";

const root = NodePath.resolve(import.meta.dirname, "..");
const CODE = /\.(?:[cm]?[jt]sx?|astro)$/;

const MOBILE_NATIVE =
  /^apps\/mobile\/.*\.(swift|kt|kts)$|^apps\/mobile\/(\.swiftlint\.yml|detekt\.yml|\.editorconfig|Brewfile)$|^scripts\/mobile-native-static-check\.ts$|^package\.json$|^\.github\/workflows\/ci\.yml$/;

const gitOutput = (...args: Array<string>) =>
  NodeChildProcess.execFileSync("git", ["-c", "core.quotePath=false", ...args], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
const git = (...args: Array<string>) =>
  gitOutput(...args)
    .split("\n")
    .filter(Boolean);

const checkInput = /(^|\/)\.(generated|astro)\/|\.d\.ts$|(^|\/)\.env[^/]*$/;
const inNodeModules = /(^|\/)node_modules\//;

const ignoredCheckInputs = () => {
  const list = (...args: Array<string>) =>
    gitOutput("ls-files", "-z", ...args)
      .split("\0")
      .filter(Boolean);
  const ignored = ["--others", "--ignored", "--exclude-standard"];
  const entries = [
    ...new Set([...list(...ignored, "--directory"), ...list("-k", "--directory")]),
  ].sort();
  const directories = entries.filter(
    (entry, index) =>
      entry.endsWith("/") && !inNodeModules.test(entry) && !entries[index + 1]?.startsWith(entry),
  );
  const files = entries.filter((entry) => !entry.endsWith("/"));
  const longest = directories.reduce((max, dir) => Math.max(max, dir.length), 0);
  const size = Math.max(1, Math.floor(30_000 / (longest + 16)));
  for (let start = 0; start < directories.length; start += size) {
    const batch = directories.slice(start, start + size).map((dir) => `:(literal)${dir}`);
    files.push(...list(...ignored, "--", ":(literal).git/", ...batch));
  }
  return files
    .filter((file) => !inNodeModules.test(file) && (file.endsWith("/") || checkInput.test(file)))
    .sort();
};

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
const override = (flag: string, envName: string) =>
  flags.has(flag)
    ? positiveInt(flag, flags.get(flag))
    : process.env[envName] === undefined
      ? undefined
      : positiveInt(envName, process.env[envName]);

const GiB = 1024 ** 3;
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
const untracked = git("ls-files", "--others", "--exclude-standard");
const files = [
  ...new Set([...git("diff", "--name-only", "--no-renames", base, "--"), ...untracked]),
].toSorted();

if (files.length === 0) {
  console.log(`check:changed: no changes since ${base.slice(0, 12)}.`);
  process.exit(0);
}
console.log(`check:changed: ${files.length} files since ${base.slice(0, 12)}`);

const inputKey = () => {
  const hash = NodeCrypto.createHash("sha256");
  hash.update(`${process.version}\0${base}\0${process.env.CI ?? ""}\0`);
  hash.update(
    NodeChildProcess.execFileSync(
      "git",
      ["diff", "--binary", "--no-renames", "--no-ext-diff", "--no-textconv", base, "--"],
      { cwd: root, maxBuffer: 1024 * 1024 * 1024 },
    ),
  );
  const ignored = ignoredCheckInputs();
  for (const file of [
    ...git("diff", "--name-only", "--no-renames", base, "--"),
    ...git("ls-files", "--others", "--exclude-standard"),
    ...ignored,
    "node_modules/.modules.yaml",
    "node_modules/.pnpm/lock.yaml",
  ]) {
    hash.update(`\0${file}\0`);
    const path = NodePath.join(root, file);
    if (NodeFS.statSync(path, { throwIfNoEntry: false })?.isFile()) {
      hash.update(NodeFS.readFileSync(path));
    }
  }
  return hash.digest("hex");
};
const key = inputKey();
const cachePath = NodePath.join(root, "node_modules/.cache/check-changed.json");
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

const TEST = /\.test\.[cm]?[jt]sx?$/;
const tests = new Set(code.filter((file) => TEST.test(file)));
for (const file of code) {
  const dir = NodePath.dirname(file);
  const prefix = `${NodePath.basename(file).replace(CODE, "")}.`;
  for (const entry of NodeFS.readdirSync(NodePath.join(root, dir))) {
    if (entry.startsWith(prefix) && TEST.test(entry)) tests.add(NodePath.join(dir, entry));
  }
}
if (affected.includes("supaterm")) tests.add("apps/server/src/provider/AgentContextBudget.test.ts");

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const compilerApps = [
  {
    root: "apps/web/src/",
    name: (file: string) => file,
    compiled: (file: string) =>
      /\.tsx?$/.test(file) && !/\.(test|browser)\.tsx?$/.test(file) && !file.endsWith(".gen.ts"),
    always: [],
  },
  {
    root: "apps/mobile/src/",
    name: (file: string) => file.slice("apps/mobile/".length),
    compiled: (file: string) => /\.tsx?$/.test(file) && !/\.(test\.tsx?|d\.ts)$/.test(file),
    always: ["^(?!.*compiles )"],
  },
].flatMap(({ root: appRoot, name, compiled, always }) => {
  const changed = files.filter((file) => file.startsWith(appRoot) && compiled(file));
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

const nodeTests = [...tests].filter((file) =>
  /from ["']node:test["']/.test(NodeFS.readFileSync(NodePath.join(root, file), "utf8")),
);
const vitestTests = [...tests].filter((file) => !nodeTests.includes(file));

const runKnip = files.some(
  (file) => CODE.test(file) || NodePath.basename(file) === "package.json" || file === "knip.jsonc",
);

const runPatchCheck = files.some(
  (file) =>
    file === "pnpm-workspace.yaml" ||
    file === "pnpm-lock.yaml" ||
    file === ".pnpmfile.cjs" ||
    file.startsWith("patches/") ||
    file.startsWith("apps/mobile/deps/") ||
    NodePath.basename(file) === "package.json",
);

const env = process.stdout.isTTY ? { ...process.env, FORCE_COLOR: "1" } : process.env;
type Outcome = "pass" | "FAIL" | "TIMEOUT";
type StepResult = { readonly outcome: Outcome; readonly output: Buffer };
const spawnStep = (command: string, args: ReadonlyArray<string>, cwd: string, deadline: number) =>
  new Promise<StepResult>((resolve) => {
    const output: Array<Buffer> = [];
    const child = NodeChildProcess.spawn(command, args, { cwd, env, detached: true });
    const timer = setTimeout(
      () => {
        try {
          // oxlint-disable-next-line supaterm/no-global-process-runtime -- This script runs without an Effect runtime.
          if (NodeOS.platform() === "win32") {
            NodeChildProcess.spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
              stdio: "ignore",
            });
          } else if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
        child.stdout.destroy();
        child.stderr.destroy();
        child.unref();
        resolve({ outcome: "TIMEOUT", output: Buffer.alloc(0) });
      },
      Math.max(0, deadline - performance.now()),
    );
    child.stdout.on("data", (chunk: Buffer) => output.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => output.push(chunk));
    child.on("error", (error) => output.push(Buffer.from(`${error.message}\n`)));
    child.on("close", (status) => {
      clearTimeout(timer);
      resolve({ outcome: status === 0 ? "pass" : "FAIL", output: Buffer.concat(output) });
    });
  });

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
      ...vitePlusCommand(["install", "--lockfile-only", "--ignore-scripts"]),
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

const graphql = ["apps/server", "packages/source-control-github"].filter((dir) =>
  files.some((file) => file.startsWith(`${dir}/`)),
);

const iconInputs = files.some(
  (file) => file.startsWith("apps/marketing/src/lib/boltComputer/") || file.startsWith("assets/"),
);

const filters = (names: ReadonlyArray<string>) => names.flatMap((name) => ["--filter", name]);
const typecheckWorkers = Math.min(concurrency, affected.length);
const steps = [
  runPatchCheck && { name: "unused patches", run: checkPatches },
  present.length > 0 && {
    name: "format",
    args: ["fmt", "--check", "--no-error-on-unmatched-pattern", ...present],
  },
  code.length > 0 && { name: "lint", args: ["lint", "--no-error-on-unmatched-pattern", ...code] },
  runKnip && { name: "knip", args: ["run", "knip:check"] },
  ...graphql.map((dir) => ({
    name: `graphql (${dir})`,
    args: ["run", "--filter", `./${dir}`, "generate", "--check"],
  })),
  iconInputs && { name: "icon inputs", args: ["run", "icons:check-inputs"] },
  affected.length > 0 && {
    name: `typecheck (${affected.length} packages${everything ? ", all" : ""})`,
    args: [
      "run",
      "--cache",
      "--parallel",
      "--concurrency-limit",
      String(typecheckWorkers),
      ...filters(affected),
      "typecheck",
    ],
    weight: typecheckWorkers,
  },
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
          ...("command" in step && step.command
            ? ([step.command, step.args] as const)
            : vitePlusCommand(step.args)),
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
if (results.some((result) => result.outcome !== "pass")) {
  process.exitCode = 1;
} else if (inputKey() !== key) {
  console.log("  pass not cached: files changed during the run");
} else {
  try {
    const temp = `${cachePath}.${process.pid}`;
    NodeFS.mkdirSync(NodePath.dirname(cachePath), { recursive: true });
    NodeFS.writeFileSync(temp, JSON.stringify({ key, summary }));
    NodeFS.renameSync(temp, cachePath);
  } catch (error) {
    console.warn(`  pass not cached: ${error instanceof Error ? error.message : String(error)}`);
  }
}
