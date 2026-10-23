// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - Skill helpers run as plain Node scripts without an Effect runtime.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";

const USAGE = `Usage: node .agents/skills/bring-us-upstream/scripts/find-unlanded-removals.ts \\
  --upstream <t3code checkout> --base <ref> --end <ref> [--fork-ref <ref>] [--min-length <chars>]

Run from the Supaterm checkout. Without --fork-ref, the working tree is searched.`;

// Upstream names the port renames. Keep in step with the branding the port applies.
const RENAMES: ReadonlyArray<readonly [RegExp, string]> = [
  [/@t3tools\//g, "@supaterm/"],
  [/com\.t3tools\./g, "com.supaterm."],
  [/T3CODE_/g, "SUPATERM_"],
  [/T3_ACP_/g, "SUPATERM_ACP_"],
  [/T3 Code/g, "Supaterm"],
  [/t3code-/g, "supaterm-"],
  [/font-t3-/g, "font-supaterm-"],
  [/\bt3_([a-z])/g, "supaterm_$1"],
];

const LOCKFILE = /(^|\/)(pnpm-lock\.yaml|package-lock\.json|bun\.lockb?|Podfile\.lock)$/;

const { values } = NodeUtil.parseArgs({
  options: {
    upstream: { type: "string" },
    base: { type: "string" },
    end: { type: "string" },
    "fork-ref": { type: "string" },
    "min-length": { type: "string", default: "30" },
  },
});
const { upstream, base, end } = values;
const forkRef = values["fork-ref"];
const minLength = Number(values["min-length"]);
if (!upstream || !base || !end || !Number.isInteger(minLength)) {
  console.error(USAGE);
  process.exit(2);
}

const git = (cwd: string, args: ReadonlyArray<string>) =>
  NodeChildProcess.execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    maxBuffer: 1 << 30,
    stdio: ["ignore", "pipe", "ignore"],
  });

const forkRoot = git(process.cwd(), ["rev-parse", "--show-toplevel"]).trim();
const range = `${base}..${end}`;

const toForkNames = (text: string) =>
  RENAMES.reduce((renamed, [pattern, replacement]) => renamed.replace(pattern, replacement), text);

const tryGit = (cwd: string, args: ReadonlyArray<string>) => {
  try {
    return git(cwd, args);
  } catch {
    return null;
  }
};

const readFork = (path: string): string | null => {
  if (forkRef) return tryGit(forkRoot, ["show", `${forkRef}:${path}`]);
  const absolute = NodePath.join(forkRoot, path);
  return NodeFS.existsSync(absolute) ? NodeFS.readFileSync(absolute, "utf8") : null;
};

const trimmedLines = (text: string) => text.split("\n").map((line) => line.trim());

const cached = <T>(load: (path: string) => T) => {
  const cache = new Map<string, { readonly value: T }>();
  return (path: string) => {
    let entry = cache.get(path);
    if (!entry) {
      entry = { value: load(path) };
      cache.set(path, entry);
    }
    return entry.value;
  };
};

const upstreamEndLines = cached((path) => {
  const text = tryGit(upstream, ["show", `${end}:${path}`]);
  return text === null ? null : new Set(trimmedLines(text));
});
const forkLines = cached((path) => {
  const text = readFork(path);
  return text === null ? null : trimmedLines(text);
});

interface Removal {
  readonly path: string;
  readonly commit: string;
  // null when the commit deleted the whole file.
  readonly text: string | null;
}

// Per-commit patches, not the range's net diff, so a change added and reverted
// inside the range still shows its removals. Newest first: the first removal
// seen for a line names the commit that last removed it.
const removals: Array<Removal> = [];
let commit = "";
let oldPath: string | null = null;
let inHunk = false;
for (const line of git(upstream, [
  "log",
  "-p",
  "-U0",
  "-M",
  "--no-color",
  "--no-merges",
  "--format=%x00%h %s",
  range,
]).split("\n")) {
  if (line.startsWith("\u0000")) {
    commit = line.slice(1);
  } else if (line.startsWith("diff --git ")) {
    inHunk = false;
    oldPath = null;
  } else if (!inHunk && line.startsWith("--- ")) {
    oldPath = line === "--- /dev/null" ? null : line.slice("--- a/".length);
  } else if (!inHunk && line.startsWith("+++ ")) {
    if (line === "+++ /dev/null" && oldPath !== null) {
      removals.push({ path: oldPath, commit, text: null });
    }
    oldPath = line === "+++ /dev/null" ? null : line.slice("+++ b/".length);
  } else if (line.startsWith("@@")) {
    inHunk = true;
  } else if (inHunk && oldPath !== null && line.startsWith("-")) {
    const text = line.slice(1).trim();
    if (text.length >= minLength) removals.push({ path: oldPath, commit, text });
  }
}

interface Candidate {
  readonly path: string;
  readonly commit: string;
  readonly forkLine: number | null;
  readonly text: string;
}

const seen = new Set<string>();
const candidates: Array<Candidate> = [];
for (const removal of removals) {
  const key = `${removal.path}\u0000${removal.text ?? ""}`;
  if (LOCKFILE.test(removal.path) || seen.has(key)) continue;
  seen.add(key);
  const fork = forkLines(removal.path);
  if (fork === null) continue;
  const kept = upstreamEndLines(removal.path);
  if (removal.text === null) {
    if (kept === null) {
      candidates.push({ ...removal, forkLine: null, text: "(file deleted upstream)" });
    }
    continue;
  }
  if (kept?.has(removal.text)) continue;
  const index = fork.indexOf(toForkNames(removal.text));
  if (index === -1) continue;
  candidates.push({ ...removal, forkLine: index + 1, text: fork[index] ?? removal.text });
}

const byFile = Map.groupBy(candidates, (candidate) => candidate.path);
for (const [path, fileCandidates] of [...byFile].toSorted(([a], [b]) => a.localeCompare(b))) {
  console.log(path);
  for (const [removingCommit, commitCandidates] of Map.groupBy(fileCandidates, (c) => c.commit)) {
    console.log(`  ${removingCommit}`);
    for (const candidate of commitCandidates) {
      console.log(`    ${candidate.forkLine ?? "-"}\t${candidate.text}`);
    }
  }
}
console.log(
  `\n${candidates.length} candidate(s) in ${byFile.size} file(s) for ${range}. Map each to its CSV row: a Skip whose evidence covers it, Pending until the removal lands, or a note showing it is not a missed removal.`,
);
