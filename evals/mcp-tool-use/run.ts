#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeUtil from "node:util";
import * as NodeZlib from "node:zlib";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { FetchHttpClient } from "effect/http";
import { proxyConfig } from "../shared/proxy.ts";
import { providerAdapter } from "./providers.ts";
import { MODELS, type Model, EFFORTS, PRICES, type PricedModel, isCodex } from "./models.ts";
import { McpToolUseCase, type Config } from "./types.ts";
import { supatermContextReport } from "./prompts.ts";

import { makeSample, withDevices, buildMessages } from "./world.ts";
import { groups, passRate, summarize } from "./report.ts";
import { emptyUsage } from "./protocol.ts";
import { runSample } from "./sample.ts";
import { gradeSample } from "./grade.ts";

const PositiveInt = Schema.FiniteFromString.check(Schema.isInt(), Schema.isGreaterThan(0));

const PositiveIntOrZero = Schema.FiniteFromString.check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
);

const Flags = Schema.Struct({
  model: Schema.Literals(Object.keys(MODELS) as Array<Model>),
  template: Schema.String,
  cases: Schema.optional(Schema.Array(Schema.String)),
  out: Schema.optional(Schema.String),
  baseline: Schema.optional(Schema.String),
  case: Schema.optional(Schema.Array(Schema.String)),
  samples: Schema.optional(PositiveInt),
  concurrency: PositiveInt,
  "max-steps": Schema.optional(PositiveInt),
  effort: Schema.optional(Schema.Literals(EFFORTS)),
  "shell-model": Schema.Literals(Object.keys(PRICES) as Array<PricedModel>),
  "user-instructions": Schema.Literals(["keep", "drop"]),
  "dry-run": Schema.Boolean,
  "stop-on-regression": Schema.Boolean,
  "regression-budget": Schema.optional(PositiveIntOrZero),
  context: Schema.Boolean,
});

const decodeFlags = Schema.decodeUnknownEffect(Flags);

const decodeCase = Schema.decodeUnknownEffect(Schema.fromJsonString(McpToolUseCase));

const decodeBaselineRow = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({
      id: Schema.String,
      pass: Schema.Boolean,
      error: Schema.optional(Schema.String),
    }),
  ),
);

const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

const string = { type: "string" } as const;

const main = Effect.gen(function* () {
  const { values } = NodeUtil.parseArgs({
    options: {
      model: { ...string, default: "claude-sonnet-5-5" },
      template: string,
      cases: { ...string, multiple: true },
      out: string,
      baseline: string,
      case: { ...string, multiple: true },

      samples: string,

      concurrency: { ...string, default: "8" },

      "max-steps": string,
      effort: string,
      "shell-model": { ...string, default: "claude-haiku-5-5" },

      "user-instructions": { ...string, default: "drop" },
      "dry-run": { type: "boolean", default: false },
      "stop-on-regression": { type: "boolean", default: false },
      "regression-budget": string,

      context: { type: "boolean", default: false },
    },
  });
  const flags = yield* decodeFlags({ template: "", ...values });
  if (flags.context) {
    process.stdout.write(`${supatermContextReport(flags.model)}\n`);
    return;
  }
  if (flags["stop-on-regression"] && flags.baseline === undefined) {
    return yield* Effect.die(new Error("--stop-on-regression needs --baseline."));
  }
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const readNdjson = <A, E>(file: string, decode: (line: string) => Effect.Effect<A, E>) =>
    fs.readFileString(file).pipe(
      Effect.map((content) => content.split("\n").filter((line) => line.trim() !== "")),
      Effect.flatMap((lines) => Effect.forEach(lines, (line) => decode(line))),
    );
  const casesDir = path.join(import.meta.dirname, "cases");
  const caseFiles =
    flags.cases ??
    (yield* fs.readDirectory(casesDir))
      .filter((name) => name.endsWith(".ndjson"))
      .toSorted()
      .map((name) => path.join(casesDir, name));
  const cases = (yield* Effect.forEach(caseFiles, (file) => readNdjson(file, decodeCase))).flat();
  const wanted = flags.case?.flatMap((ids) => ids.split(","));
  const codex = isCodex(flags.model);
  const harness = codex ? "codex" : "claude";
  const selected = cases.filter(
    ({ id, setup }) =>
      (wanted === undefined || wanted.includes(id)) &&
      (setup.harness === undefined || setup.harness === harness),
  );
  if (selected.length === 0) return yield* Effect.die(new Error("No case matches --case."));

  const templatePath =
    flags.template ||
    path.join(import.meta.dirname, "templates", codex ? "codex.json.gz" : "claude.json.gz");
  const templateBytes = yield* fs.readFile(templatePath);
  const template = new TextDecoder().decode(
    templatePath.endsWith(".gz") ? NodeZlib.gunzipSync(templateBytes) : templateBytes,
  );
  const keepUserInstructions = flags["user-instructions"] === "keep";
  const adapter = providerAdapter(flags.model);
  const buildFor = (role: McpToolUseCase["setup"]["role"], deviceAccess: boolean, links: boolean) =>
    adapter.capture(template, {
      model: flags.model,
      role,
      deviceAccess,
      links,
      keepUserInstructions,
      effort: flags.effort,
    });

  const baseKey = ({ setup }: McpToolUseCase) =>
    `${codex && setup.role === "native-subagent" ? "top" : setup.role}:${setup.world?.deviceAgentAccess !== false}:${setup.linkedEnvironments === true}`;
  const base = yield* buildFor("top", true, false);
  const bases = new Map<string, typeof base>([["top:true:false", base]]);
  for (const testCase of selected) {
    const key = baseKey(testCase);
    if (bases.has(key)) continue;
    const [role = "top", access, links] = key.split(":") as [
      McpToolUseCase["setup"]["role"],
      string,
      string,
    ];
    bases.set(key, yield* buildFor(role, access === "true", links === "true"));
  }
  const baseFor = (testCase: McpToolUseCase) => bases.get(baseKey(testCase)) ?? base;
  const effort = flags.effort ?? base.codex?.reasoning.effort ?? "high";
  if (flags["dry-run"]) {
    for (const testCase of selected) {
      const sample = makeSample(testCase, baseFor(testCase));
      yield* Effect.scoped(withDevices(sample));
      const messages = buildMessages(sample);
      const body = adapter.request(sample, effort, messages);
      process.stdout.write(`${yield* encodeJson(body)}\n`);
    }
    return;
  }
  const apiKey = process.env.ANTHROPIC_API_KEY ?? "";
  const out = flags.out;
  if ((!apiKey && !codex) || out === undefined) {
    const message =
      "Set ANTHROPIC_API_KEY and pass --out <directory>. ANTHROPIC_AUTH_TOKEN and ANTHROPIC_BASE_URL are never used.";
    return yield* Effect.die(new Error(message));
  }
  const config: Config = {
    apiKey,
    model: flags.model,
    ...(codex ? { proxy: proxyConfig() } : {}),
    effort,
    maxSteps: flags["max-steps"] ?? (codex ? 10 : 6),
    shellModel: flags["shell-model"],
  };
  const previous =
    flags.baseline === undefined ? [] : yield* readNdjson(flags.baseline, decodeBaselineRow);
  const baseline = new Map(
    groups(previous, (row) => row.id)
      .map(([id, r]) => [id, passRate(r)] as const)
      .filter(([, rate]) => !Number.isNaN(rate)),
  );

  const passedBefore = (id: string) => baseline.get(id) === 1;

  const commit = yield* Effect.try(() =>
    NodeChildProcess.execFileSync("git", ["describe", "--always", "--dirty"], {
      encoding: "utf8",
    }).trim(),
  ).pipe(Effect.orElseSucceed(() => "unknown"));
  const inFlight = yield* Semaphore.make(flags.concurrency);
  const runOne = (testCase: McpToolUseCase) => {
    const { id, kind, pattern } = testCase;
    const identity = { id, kind, pattern, role: testCase.setup.role };
    const usage = { usage: emptyUsage(), shellUsage: emptyUsage() };
    const privateValues = [config.apiKey, ...Object.values(config.proxy?.headers ?? {})]
      .flatMap((value) => [value, value.replace(/^Bearer /i, "")])
      .filter(Boolean);
    return runSample(testCase, config, baseFor(testCase), usage).pipe(
      inFlight.withPermits(1),
      Effect.matchCause({
        onFailure: (cause) => ({
          ...identity,
          ...usage,
          pass: false,
          error: privateValues.reduce(
            (message, value) => message.replaceAll(value, "[redacted]"),
            Cause.pretty(cause),
          ),
        }),
        onSuccess: (sample) => {
          const checks = gradeSample(testCase.expect, sample);
          return { ...identity, pass: checks.every((check) => check.pass), checks, ...sample };
        },
      }),
      Effect.tap((row) =>
        Effect.log(`${row.id}: ${"error" in row ? "ERROR" : row.pass ? "pass" : "FAIL"}`),
      ),
    );
  };

  const runCase = Effect.fn("evaluateMcpToolUse.runCase")(function* (testCase: McpToolUseCase) {
    const samples = Array.from({ length: flags.samples ?? 2 }, () => testCase);
    const first = yield* Effect.forEach(samples, runOne, { concurrency: "unbounded" });
    const split = flags.samples === undefined && new Set(first.map((row) => row.pass)).size > 1;
    return split ? [...first, yield* runOne(testCase)] : first;
  });

  const stopEarly = flags["stop-on-regression"];
  const budget = flags["regression-budget"] ?? 0;
  const ordered = stopEarly
    ? selected.toSorted((a, b) => Number(passedBefore(b.id)) - Number(passedBefore(a.id)))
    : selected;
  const rows: Array<Effect.Success<ReturnType<typeof runOne>>> = [];
  const regressions: Array<string> = [];
  yield* Effect.forEach(
    ordered,
    (testCase) =>
      runCase(testCase).pipe(
        Effect.flatMap((caseRows) => {
          rows.push(...caseRows);

          if (!stopEarly || !passedBefore(testCase.id) || !(passRate(caseRows) <= 0.5)) {
            return Effect.void;
          }
          regressions.push(testCase.id);
          return regressions.length > budget ? Effect.fail(testCase.id) : Effect.void;
        }),
      ),
    { concurrency: flags.concurrency, discard: true },
  ).pipe(Effect.ignore);
  const samples = flags.samples === undefined ? "2-3 (adaptive)" : flags.samples;
  const header = `Commit \`${commit}\`, ${flags.model} at ${effort} effort, user instructions ${flags["user-instructions"]}, ${samples} samples per case, template \`${path.basename(templatePath)}\``;
  const finished = new Set(rows.map((row) => row.id)).size;
  const stopped =
    regressions.length === 0
      ? []
      : [
          `- Regressions (passed every baseline sample, now fail): ${regressions.map((id) => `\`${id}\``).join(", ")}.${regressions.length > budget ? ` Stopped with ${finished} of ${selected.length} cases finished.` : ""}`,
        ];
  const summary = summarize(
    rows,
    {
      header: [header, supatermContextReport(flags.model), ...stopped].join("\n"),
      shellModel: config.shellModel,
      model: config.model,
    },
    flags.baseline === undefined ? undefined : baseline,
  );
  yield* fs.makeDirectory(out, { recursive: true });
  const lines = yield* Effect.forEach(rows, (row) => encodeJson(row));
  yield* fs.writeFileString(path.join(out, "results.jsonl"), `${lines.join("\n")}\n`);
  yield* fs.writeFileString(path.join(out, "summary.md"), summary);
  yield* Effect.log(`Wrote ${rows.length} samples to ${out}.\n\n${summary}`);
});

if (import.meta.main) {
  main.pipe(
    Effect.provide(Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer)),
    NodeRuntime.runMain,
  );
}
