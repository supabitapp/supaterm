import { type Usage, type ResultRow } from "./types.ts";
import { type PricedModel, PRICES, type Model, isCodex } from "./models.ts";
import { NEUTRAL_IDENTITY } from "./protocol.ts";

export const passRate = (
  rows: ReadonlyArray<{ readonly pass: boolean; readonly error?: string | undefined }>,
) => {
  const finished = rows.filter((row) => row.error === undefined);
  return finished.filter((row) => row.pass).length / finished.length;
};

const percent = (rate: number) => (Number.isNaN(rate) ? "-" : `${Math.round(rate * 100)}%`);

export const groups = <A>(rows: ReadonlyArray<A>, key: (row: A) => string) =>
  [...Map.groupBy(rows, key)].toSorted(([left], [right]) => left.localeCompare(right));

const USAGE_KEYS = ["input", "output", "cacheWrite", "cacheRead"] as const;

const spend = (usages: ReadonlyArray<Usage>, model: PricedModel | undefined) => {
  const total = (key: keyof Usage) => usages.reduce((sum, usage) => sum + usage[key], 0);
  const price = (key: keyof Usage) => (model ? PRICES[model][key] : 0);
  const cost = USAGE_KEYS.reduce((sum, key) => sum + total(key) * price(key), 0) / 1e6;
  return { cost, tokens: USAGE_KEYS.map((key) => `${key} ${total(key)}`).join(", ") };
};

export const summarize = (
  rows: Array<ResultRow>,
  options: { readonly header: string; readonly shellModel: PricedModel; readonly model: Model },
  before?: Map<string, number>,
) => {
  const codex = isCodex(options.model);
  const agent = spend(
    rows.map((row) => row.usage),
    codex ? undefined : options.model,
  );
  const shell = spend(
    rows.map((row) => row.shellUsage),
    options.shellModel,
  );
  const cost = agent.cost + shell.cost;
  const table = (title: string, key: (row: ResultRow) => string, compare = false) => [
    `## ${title}\n`,
    compare ? "| Group | Pass | Baseline | Delta |" : "| Group | Pass |",
    compare ? "| --- | --- | --- | --- |" : "| --- | --- |",
    ...groups(rows, key).map(([group, members]) => {
      const now = passRate(members);
      const was = before?.get(group);
      const errored = members.filter((row) => row.error !== undefined).length;
      const delta =
        was === undefined
          ? "new | |"
          : `${percent(was)} | ${Number.isNaN(now) ? "" : `${Math.round((now - was) * 100)} pts`} |`;
      const pass = `${percent(now)} of ${members.length - errored}${errored > 0 ? `, ${errored} errored` : ""}`;
      return `| ${group} | ${pass} |${compare ? ` ${delta}` : ""}`;
    }),
    "",
  ];
  const errors = groups(
    rows.filter((row) => row.error !== undefined),
    (row) => row.id,
  );
  const errorNote = `- Errored: ${errors.map(([id, failed]) => `${id} ×${failed.length}`).join(", ")}. These samples did not finish, even after retries, so pass rates leave them out; tokens they spent are counted.`;
  const nativeNote =
    "- native-subagent cases are approximate: the harness gives subagents their own system prompt, which this runner does not rebuild. Supaterm's append is left out and its SubagentStart hook context added after the task.";
  const identityNote = `- The captured Claude Code identity line is replaced with "${NEUTRAL_IDENTITY}"`;
  const finished = rows.filter((row) => row.error === undefined).length;
  return [
    "# MCP tool-use eval\n",
    `- ${options.header}`,
    `- Pass: ${percent(passRate(rows))} of ${finished} samples.`,
    ...(errors.length > 0 ? [errorNote] : []),
    codex
      ? "- Cost: not applicable (subscription through proxy)."
      : `- Estimated cost $${cost.toFixed(2)}, $${(cost / rows.length).toFixed(3)} per sample.`,
    `- Agent tokens: ${agent.tokens}${codex ? "." : ` ($${agent.cost.toFixed(2)}).`}`,
    `- Shell simulator (${options.shellModel}) tokens: ${shell.tokens} (API-price estimate $${shell.cost.toFixed(2)}).`,
    ...(codex
      ? [
          "- Code-mode tools use case mocks and a simulated machine. Native subagent prompts and asynchronous notifications are approximate.",
        ]
      : [identityNote]),
    ...(rows.some((row) => row.role === "native-subagent") ? [nativeNote] : []),
    "",
    ...table("Cases", (row) => row.id, before !== undefined),
    ...table("By kind", (row) => row.kind),
    ...table("By pattern", (row) => row.pattern),
  ].join("\n");
};
