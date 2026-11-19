import * as Effect from "effect/Effect";
import * as Path from "effect/Path";

import { expandHomePath } from "@supaterm/provider-core/server/pathExpansion";
import {
  tokenCount,
  totalTokens,
  type ProviderUsageReader,
  type TranscriptUsageFormat,
  type UsageRecord,
} from "@supaterm/provider-core/server/usage";

import type { GrokSettings } from "../settings.ts";
import * as HostProcess from "@supaterm/shared/HostProcess";

export const GROK_COST_USD_TICKS_PER_DOLLAR = 10_000_000_000;

function grokCostTicksToUsd(ticks: unknown) {
  if (typeof ticks !== "number" || !Number.isFinite(ticks) || ticks < 0) return null;
  return ticks / GROK_COST_USD_TICKS_PER_DOLLAR;
}

interface GrokUsageTotals {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedReadTokens: number;
  readonly cacheCreationTokens: number;
  readonly reasoningTokens: number;
  readonly costUsdTicks: number | null;
}

function readGrokUsageTotals(value: unknown) {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  return {
    inputTokens: tokenCount(record["inputTokens"]),
    outputTokens: tokenCount(record["outputTokens"]),
    cachedReadTokens: tokenCount(record["cachedReadTokens"]),
    cacheCreationTokens: tokenCount(record["cacheCreationTokens"]),
    reasoningTokens: tokenCount(record["reasoningTokens"]),
    costUsdTicks:
      typeof record["costUsdTicks"] === "number" && Number.isFinite(record["costUsdTicks"])
        ? record["costUsdTicks"]
        : null,
  };
}

function grokTotalsToUsage(totals: GrokUsageTotals) {
  const cachedInputTokens = totals.cachedReadTokens;
  const cacheCreationTokens = totals.cacheCreationTokens;
  const uncachedInputTokens = Math.max(
    0,
    totals.inputTokens - cachedInputTokens - cacheCreationTokens,
  );
  const outputTokens = totals.outputTokens;
  return {
    uncachedInputTokens,
    cachedInputTokens,
    cacheCreationTokens,
    outputTokens,
    reasoningTokens: Math.min(outputTokens, totals.reasoningTokens),
  };
}

export function parseGrokLine(line: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return [] satisfies readonly UsageRecord[];
  }
  return parseGrokRecord(parsed) satisfies readonly UsageRecord[];
}

function parseGrokRecord(parsed: unknown) {
  if (typeof parsed !== "object" || parsed === null) return [] satisfies readonly UsageRecord[];

  const record = parsed as Record<string, unknown>;
  const params = record["params"];
  if (typeof params !== "object" || params === null) return [] satisfies readonly UsageRecord[];
  const paramsRecord = params as Record<string, unknown>;

  const update = paramsRecord["update"];
  if (typeof update !== "object" || update === null) return [] satisfies readonly UsageRecord[];
  const updateRecord = update as Record<string, unknown>;
  if (updateRecord["sessionUpdate"] !== "turn_completed")
    return [] satisfies readonly UsageRecord[];

  const usage = updateRecord["usage"];
  if (typeof usage !== "object" || usage === null) return [] satisfies readonly UsageRecord[];
  const usageRecord = usage as Record<string, unknown>;

  const sessionId = typeof paramsRecord["sessionId"] === "string" ? paramsRecord["sessionId"] : "";
  const promptId = typeof updateRecord["prompt_id"] === "string" ? updateRecord["prompt_id"] : null;

  const meta = paramsRecord["_meta"];
  let timestampMs: number | null = null;
  if (typeof meta === "object" && meta !== null) {
    const agentTimestampMs = (meta as Record<string, unknown>)["agentTimestampMs"];
    if (typeof agentTimestampMs === "number" && Number.isFinite(agentTimestampMs)) {
      timestampMs = agentTimestampMs;
    }
  }
  if (timestampMs === null) {
    const timestamp = record["timestamp"];
    if (typeof timestamp === "number" && Number.isFinite(timestamp)) {
      timestampMs = timestamp > 1e12 ? timestamp : timestamp * 1000;
    }
  }
  if (timestampMs === null) return [] satisfies readonly UsageRecord[];

  const topLevel = readGrokUsageTotals(usageRecord);
  if (topLevel === null) return [] satisfies readonly UsageRecord[];

  const modelUsage = usageRecord["modelUsage"];
  const modelEntries: Array<{ model: string; totals: GrokUsageTotals }> = [];
  if (typeof modelUsage === "object" && modelUsage !== null) {
    for (const [model, raw] of Object.entries(modelUsage as Record<string, unknown>)) {
      if (model.length === 0) continue;
      const totals = readGrokUsageTotals(raw);
      if (totals === null) continue;
      modelEntries.push({ model, totals });
    }
  }

  if (modelEntries.length === 0) {
    if (totalTokens(grokTotalsToUsage(topLevel)) === 0) return [] satisfies readonly UsageRecord[];
    return [
      {
        provider: "grok",
        timestampMs,
        model: "grok",
        sessionId,
        totals: grokTotalsToUsage(topLevel),
        reportedCostUsd: grokCostTicksToUsd(topLevel.costUsdTicks),
        speed: "standard",
        dedupeKey: promptId === null ? null : `${sessionId}:${promptId}:${timestampMs}:grok`,
      },
    ] satisfies readonly UsageRecord[];
  }

  const topLevelCostUsd = grokCostTicksToUsd(topLevel.costUsdTicks);
  let usedTickedCostUsd = 0;
  let untickedTokenDenominator = 0;
  for (const entry of modelEntries) {
    const tokens = totalTokens(grokTotalsToUsage(entry.totals));
    if (tokens === 0) continue;
    if (entry.totals.costUsdTicks !== null) {
      usedTickedCostUsd += grokCostTicksToUsd(entry.totals.costUsdTicks) ?? 0;
    } else {
      untickedTokenDenominator += tokens;
    }
  }
  const remainingCostUsd =
    topLevelCostUsd === null ? null : Math.max(0, topLevelCostUsd - usedTickedCostUsd);

  const results: UsageRecord[] = [];
  for (const entry of modelEntries) {
    const totals = grokTotalsToUsage(entry.totals);
    if (totalTokens(totals) === 0) continue;

    let reportedCostUsd = grokCostTicksToUsd(entry.totals.costUsdTicks);
    if (reportedCostUsd === null && remainingCostUsd !== null && untickedTokenDenominator > 0) {
      reportedCostUsd = remainingCostUsd * (totalTokens(totals) / untickedTokenDenominator);
    }

    results.push({
      provider: "grok",
      timestampMs,
      model: entry.model,
      sessionId,
      totals,
      reportedCostUsd,
      speed: "standard",
      dedupeKey:
        promptId === null ? null : `${sessionId}:${promptId}:${timestampMs}:${entry.model}`,
    });
  }
  return results satisfies readonly UsageRecord[];
}

export const grokUsageFormat: TranscriptUsageFormat<void> = {
  selectFields: {
    timestamp: true,
    params: {
      sessionId: true,
      _meta: { agentTimestampMs: true },
      update: { sessionUpdate: true, prompt_id: true, usage: true },
    },
  },
  usageMarkers: ['"turn_completed"'],
  parseLine: (line) => parseGrokLine(line),
  parseProjected: (projected) => parseGrokRecord(projected),
};

export const grokUsageReader: ProviderUsageReader<GrokSettings, Path.Path> = {
  kind: "transcripts",
  provider: "grok",
  format: grokUsageFormat,
  directories: Effect.fn("grokUsageReader.directories")(function* ({ environment }) {
    const path = yield* Path.Path;
    const homeDirectory = yield* HostProcess.HomeDirectory;
    const home = expandHomePath(
      environment.GROK_HOME?.trim() || path.join(homeDirectory, ".grok"),
      homeDirectory,
    );
    return [{ dir: path.resolve(home, "sessions"), fileName: "updates.jsonl" }];
  }),
};
