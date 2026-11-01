// @effect-diagnostics nodeBuiltinImport:off - a one-off maintenance script with no
// Effect runtime; it only calls the GitHub CLI and writes one file.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const MIN_RECORDED_SECONDS = 0.5;
const SERVER_SHARD_JOB = /^Test Server \d+$/;
// Runner timestamp, then Vitest's default reporter line for the run start or a finished file.
const RUN_START = /^(\S+Z)\s+RUN\s+v/;
const FILE_RESULT = /^(\S+Z)\s+[✓❯×]\s+(\S+\.test\.\w+) \(\d+ tests?[^)]*\)\s+\d+ms$/;

const gh = (...args: ReadonlyArray<string>) =>
  NodeChildProcess.execFileSync("gh", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });

const runId =
  process.argv[2] ??
  gh(
    "run",
    "list",
    "--workflow=ci.yml",
    "--branch=main",
    "--status=success",
    "--limit=1",
    "--json=databaseId",
    "--jq=.[0].databaseId",
  ).trim();

const jobIds = gh(
  "api",
  "--paginate",
  `repos/{owner}/{repo}/actions/runs/${runId}/jobs?per_page=100`,
  "--jq",
  ".jobs[] | [.id, .name] | @tsv",
)
  .trim()
  .split("\n")
  .map((row) => row.split("\t"))
  .filter(([, name]) => name !== undefined && SERVER_SHARD_JOB.test(name))
  .map(([id]) => id!);
if (jobIds.length === 0) throw new Error(`CI run ${runId} has no Test Server jobs.`);

// Server files run one at a time, so the gap between consecutive results is a file's whole
// cost, including the imports the reported test time leaves out.
const seconds = new Map<string, number>();
for (const jobId of jobIds) {
  const log = gh(
    "api",
    "--allow-escape-sequences",
    `repos/{owner}/{repo}/actions/jobs/${jobId}/logs`,
  );
  let previous: number | undefined;
  for (const line of log.replaceAll(/\u001b\[[0-9;]*m/g, "").split("\n")) {
    const start = RUN_START.exec(line);
    if (start) previous = Date.parse(start[1]!);
    const match = FILE_RESULT.exec(line.trimEnd());
    if (!match || previous === undefined) continue;
    const finished = Date.parse(match[1]!);
    seconds.set(match[2]!, Math.round((finished - previous) / 100) / 10);
    previous = finished;
  }
}
if (seconds.size === 0) throw new Error(`No test file durations found in CI run ${runId}.`);

const weights = Object.fromEntries(
  [...seconds]
    .filter(([, value]) => value >= MIN_RECORDED_SECONDS)
    .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
);
const weightsPath = NodeURL.fileURLToPath(
  new URL("../src/testUtils/shardWeights.json", import.meta.url),
);
NodeFS.writeFileSync(weightsPath, `${JSON.stringify(weights, null, 2)}\n`);
process.stdout.write(
  `Recorded ${Object.keys(weights).length} of ${seconds.size} files from CI run ${runId} into ${NodePath.relative(process.cwd(), weightsPath)}.\n`,
);
