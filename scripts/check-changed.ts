// @effect-diagnostics nodeBuiltinImport:off globalConsole:off

import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeOS from "node:os";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { affectedPackages, readWorkspace } from "./lib/changed-packages.ts";

const root = NodePath.resolve(import.meta.dirname, "..");
const CODE = /\.[cm]?[jt]sx?$/;

const MOBILE_NATIVE =
  /^apps\/mobile\/.*\.(swift|kt|kts)$|^apps\/mobile\/(\.swiftlint\.yml|detekt\.yml|\.editorconfig|Brewfile)$|^scripts\/mobile-native-static-check\.ts$|^package\.json$|^\.github\/workflows\/ci\.yml$/;

const git = (...args: Array<string>) =>
  NodeChildProcess.execFileSync("git", ["-c", "core.quotePath=false", ...args], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
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

const untracked = git("ls-files", "--others", "--exclude-standard");
const files = [
  ...new Set([...git("diff", "--name-only", "--no-renames", base, "--"), ...untracked]),
].toSorted();

if (files.length === 0) {
  console.log(`check:changed: no changes since ${base.slice(0, 12)}.`);
  process.exit(0);
}

const inputKey = () => {
  const hash = NodeCrypto.createHash("sha256");

  hash.update(`${process.version}\0${base}\0`);
  hash.update(JSON.stringify(Object.entries(process.env).sort(([a], [b]) => a.localeCompare(b))));
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
    ...git("diff", "--name-only", "--no-renames", base, "--"),
    ...git("ls-files", "--others", "--exclude-standard"),
    ...ignored,
    "node_modules/.modules.yaml",
    "node_modules/.pnpm/lock.yaml",
    "node_modules/.pnpm-workspace-state-v1.json",
    "node_modules/.package-lock.json",
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
const lintAll = files.some(
  (file) =>
    file === "vite.config.ts" ||
    file === "package.json" ||
    file === "pnpm-lock.yaml" ||
    file.startsWith("oxlint-plugin-supaterm/"),
);
const { affected, everything } = affectedPackages(files, readWorkspace(root));

const TEST = /\.test\.[cm]?[jt]sx?$/;
const tests = new Set(code.filter((file) => TEST.test(file)));
for (const file of code) {
  const dir = NodePath.dirname(file);
  const prefix = `${NodePath.basename(file).replace(CODE, "")}.`;
  for (const entry of NodeFS.readdirSync(NodePath.join(root, dir))) {
    if (entry.startsWith(prefix) && TEST.test(entry)) tests.add(NodePath.join(dir, entry));
  }
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const compilerApps = [
  {
    test: "apps/web/src/reactCompilerCoverage.test.ts",
    root: "apps/web/src/",

    name: (file: string) => file,
    compiled: (file: string) =>
      /\.tsx?$/.test(file) && !/\.(test|browser)\.tsx?$/.test(file) && !file.endsWith(".gen.ts"),

    always: [],
  },
  {
    test: "apps/mobile/src/reactCompilerCoverage.test.ts",
    root: "apps/mobile/src/",
    name: (file: string) => file.slice("apps/mobile/".length),
    compiled: (file: string) => /\.tsx?$/.test(file) && !/\.(test\.tsx?|d\.ts)$/.test(file),

    always: ["^(?!.*compiles )"],
  },
].flatMap(({ test, root: appRoot, name, compiled, always }) => {
  const changed = files.filter((file) => file.startsWith(appRoot) && compiled(file));
  if (changed.length === 0 || tests.has(test)) return [];
  const names = changed
    .values()
    .filter((file) => present.includes(file))
    .map((file) => `compiles ${escapeRegExp(name(file))}$`)
    .toArray();
  const pattern = [...names, ...always];
  return pattern.length > 0 ? [{ test, names, pattern }] : [];
});
const compilerCoverage = compilerApps.length > 0 && {
  name: `react compiler (${compilerApps.reduce((count, app) => count + app.names.length, 0)} files)`,
  args: [
    "test",
    "run",
    ...compilerApps.map((app) => app.test),
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

const graphql = ["apps/server", "packages/source-control-github"].filter((dir) =>
  files.some((file) => file.startsWith(`${dir}/`)),
);

const iconInputs = files.some(
  (file) => file.startsWith("apps/marketing/src/lib/boltComputer/") || file.startsWith("assets/"),
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

const checkPatches = (): boolean => {
  const temp = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "supaterm-patch-check-"));
  try {
    const copy = (relative: string) => {
      const dest = NodePath.join(temp, relative);
      NodeFS.mkdirSync(NodePath.dirname(dest), { recursive: true });
      NodeFS.cpSync(NodePath.join(root, relative), dest, { recursive: true });
    };
    copy("package.json");
    copy("pnpm-workspace.yaml");
    for (const pkg of readWorkspace(root)) copy(`${pkg.dir}/package.json`);
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
    const { status, stdout, stderr, error } = NodeChildProcess.spawnSync(
      "vp",
      ["install", "--lockfile-only", "--ignore-scripts"],
      { cwd: temp, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
    if (status === 0) return true;
    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);
    if (error) console.error(error.message);
    if (`${stdout ?? ""}${stderr ?? ""}`.includes("ERR_PNPM_UNUSED_PATCH")) {
      console.error(
        "Unused dependency patches: remove each patch named above from " +
          "patchedDependencies in pnpm-workspace.yaml and from patches/, " +
          "update it to the version the install resolves, " +
          "or pin the dependency that pulls it in to the patched version.",
      );
    }
    return false;
  } finally {
    NodeFS.rmSync(temp, { recursive: true, force: true });
  }
};

const filters = (names: ReadonlyArray<string>) => names.flatMap((name) => ["--filter", name]);
const steps = [
  runPatchCheck && { name: "unused patches", run: checkPatches },
  present.length > 0 && {
    name: "format",
    args: ["fmt", "--check", "--no-error-on-unmatched-pattern", ...present],
  },
  (lintAll || code.length > 0) && {
    name: lintAll ? "lint (all files: tooling changed)" : "lint",
    args: ["lint", "--report-unused-disable-directives", ...(lintAll ? [] : code)],
  },
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
      "4",
      ...filters(affected),
      "typecheck",
    ],
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

console.log(`check:changed: ${files.length} files since ${base.slice(0, 12)}`);
const results = steps.map((step) => {
  const command = "command" in step ? step.command : "vp";
  console.log(`\n> ${command} ${step.name}`);
  const started = performance.now();
  const status =
    "run" in step
      ? step.run()
        ? 0
        : 1
      : NodeChildProcess.spawnSync(command, step.args, { cwd: root, stdio: "inherit" }).status;
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
if (results.some((result) => !result.ok)) {
  process.exitCode = 1;
} else if (inputKey() !== key) {
  console.log("  pass not cached: files changed during the run");
} else {
  try {
    const temp = `${cachePath}.${process.pid}`;
    NodeFS.mkdirSync(NodePath.dirname(cachePath), { recursive: true });
    NodeFS.writeFileSync(
      temp,
      JSON.stringify({ key, summary: results.map((r) => `${r.name}: pass`) }),
    );
    NodeFS.renameSync(temp, cachePath);
  } catch (error) {
    console.warn(`  pass not cached: ${error instanceof Error ? error.message : String(error)}`);
  }
}
