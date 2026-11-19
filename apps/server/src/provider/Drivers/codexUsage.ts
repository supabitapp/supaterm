import type { CodexSettings } from "@supaterm/contracts";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import {
  parseTimestampMs,
  type ProviderUsageReader,
  type TranscriptUsageFormat,
  type UsageRecord,
  type UsageSpeed,
} from "@supaterm/provider-core/server/usage";
import type { UsageTokenTotals } from "@supaterm/contracts";

import * as CodexUsageHistory from "../../usage/CodexUsageHistory.ts";
import { resolveCodexHomeLayout } from "./CodexHomeLayout.ts";

const TokenCount = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const CodexTokenUsage = Schema.Struct({
  input_tokens: TokenCount,
  cached_input_tokens: TokenCount,
  cache_write_input_tokens: TokenCount,
  output_tokens: TokenCount,
  reasoning_output_tokens: TokenCount,
  total_tokens: TokenCount,
}).check(
  Schema.makeFilter(
    (usage) =>
      usage.cached_input_tokens + usage.cache_write_input_tokens <= usage.input_tokens &&
      usage.reasoning_output_tokens <= usage.output_tokens &&
      usage.total_tokens >= usage.input_tokens + usage.output_tokens,
  ),
);
type CodexTokenUsage = typeof CodexTokenUsage.Type;
const isCodexTokenUsage = Schema.is(CodexTokenUsage);
const CODEX_USAGE_FIELDS = Object.keys(CodexTokenUsage.fields) as (keyof CodexTokenUsage)[];

function readCodexTokenUsage(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const input = raw["input_tokens"];
  const output = raw["output_tokens"];
  if (typeof input !== "number" || typeof output !== "number") return null;
  const usage = {
    input_tokens: input,
    cached_input_tokens: raw["cached_input_tokens"] === undefined ? 0 : raw["cached_input_tokens"],
    cache_write_input_tokens:
      raw["cache_write_input_tokens"] === undefined ? 0 : raw["cache_write_input_tokens"],
    output_tokens: output,
    reasoning_output_tokens:
      raw["reasoning_output_tokens"] === undefined ? 0 : raw["reasoning_output_tokens"],
    total_tokens: raw["total_tokens"] === undefined ? input + output : raw["total_tokens"],
  };
  return isCodexTokenUsage(usage) ? usage : null;
}

function dateCodexBaseline(state: CodexScanState, timestampMs: number) {
  state.latestCumulativeAtMs = Math.max(state.latestCumulativeAtMs ?? timestampMs, timestampMs);
}

function rebaseCodexUsage(state: CodexScanState, cumulative: CodexTokenUsage, timestampMs: number) {
  state.lastCumulativeUsage = cumulative;
  dateCodexBaseline(state, timestampMs);
  delete state.unreportedRequests;
  if (cumulative.input_tokens + cumulative.output_tokens === 0) delete state.sequenceStartSignature;
}

function advanceCodexUsage(previous: CodexTokenUsage | null, last: CodexTokenUsage) {
  return readCodexTokenUsage(
    Object.fromEntries(CODEX_USAGE_FIELDS.map((key) => [key, (previous?.[key] ?? 0) + last[key]])),
  );
}

const CodexSpeed = Schema.Literals(["standard", "fast", "ultrafast"]);

const CodexUnreportedRequest = Schema.Struct({
  timestampMs: Schema.Finite,
  model: Schema.String,
  turnId: Schema.String,
  speed: CodexSpeed,
  sawThreadSettings: Schema.Boolean,
  usage: CodexTokenUsage,
});
type CodexUnreportedRequest = typeof CodexUnreportedRequest.Type;
type CodexRequestAttribution = Omit<CodexUnreportedRequest, "usage">;

function unreportedRequests(
  previous: CodexTokenUsage | null,
  cumulative: CodexTokenUsage,
  last: CodexTokenUsage,
  pending: readonly CodexUnreportedRequest[] | undefined,
) {
  if (
    previous === null ||
    pending === undefined ||
    CODEX_USAGE_FIELDS.some(
      (key) =>
        cumulative[key] - previous[key] !==
        pending.reduce((sum, request) => sum + request.usage[key], 0),
    )
  ) {
    return null;
  }
  const final = pending.at(-1)!;
  const remainder = readCodexTokenUsage(
    Object.fromEntries(CODEX_USAGE_FIELDS.map((key) => [key, final.usage[key] - last[key]])),
  );
  if (remainder === null) return null;
  return [...pending.slice(0, -1), { ...final, usage: remainder }].filter(
    (request) => request.usage.input_tokens + request.usage.output_tokens > 0,
  );
}

function discardedRequests(
  pending: readonly CodexUnreportedRequest[] | undefined,
  last: CodexTokenUsage,
) {
  const final = pending?.at(-1);
  if (pending === undefined || final === undefined) return 0;
  const reported = CODEX_USAGE_FIELDS.every((key) => final.usage[key] === last[key]);
  return pending.length - (reported ? 1 : 0);
}

/**
 * Codex `token_count` events carry no model or service tier, so both are carried forward: the model
 * from the most recent `turn_context`, the tier from the most recent `thread_settings_applied`.
 */
export const CodexScanState = Schema.Struct({
  model: Schema.mutableKey(Schema.String),
  speed: Schema.mutableKey(CodexSpeed),
  sessionId: Schema.mutableKey(Schema.String),
  lastUsageSignature: Schema.mutableKey(Schema.NullOr(Schema.String)),
  lastCumulativeUsage: Schema.mutableKey(Schema.NullOr(CodexTokenUsage)),
  sequenceStartSignature: Schema.mutableKey(Schema.optionalKey(Schema.String)),
  latestCumulativeAtMs: Schema.mutableKey(Schema.optionalKey(Schema.Finite)),
  unreportedRequests: Schema.mutableKey(
    Schema.optionalKey(Schema.mutable(Schema.Array(CodexUnreportedRequest))),
  ),
  requestLedgerActive: Schema.mutableKey(Schema.optionalKey(Schema.Boolean)),
  malformedRecords: Schema.mutableKey(TokenCount),
  sawSessionMeta: Schema.mutableKey(Schema.Boolean),
  modelProvider: Schema.mutableKey(Schema.String),
  turnId: Schema.mutableKey(Schema.String),
  sawThreadSettings: Schema.mutableKey(Schema.Boolean),
  suppressingForkCopies: Schema.mutableKey(Schema.Boolean),
  forkCopyAnchorMs: Schema.mutableKey(Schema.Finite),
});
export type CodexScanState = typeof CodexScanState.Type;

export function initialCodexScanState(): CodexScanState;
export function initialCodexScanState() {
  return {
    model: "",
    speed: "standard",
    sessionId: "",
    lastUsageSignature: null,
    lastCumulativeUsage: null,
    malformedRecords: 0,
    sawSessionMeta: false,
    modelProvider: "",
    turnId: "",
    sawThreadSettings: false,
    suppressingForkCopies: false,
    forkCopyAnchorMs: 0,
  } satisfies CodexScanState;
}

const FORK_COPY_MAX_GAP_MS = 1000;

function isForkedSessionMeta(payload: Record<string, unknown>) {
  if (typeof payload["forked_from_id"] === "string") return true;
  const source = payload["source"];
  if (typeof source !== "object" || source === null) return false;
  const subagent = (source as Record<string, unknown>)["subagent"];
  if (typeof subagent !== "object" || subagent === null) return false;
  const spawn = (subagent as Record<string, unknown>)["thread_spawn"];
  if (typeof spawn !== "object" || spawn === null) return false;
  return typeof (spawn as Record<string, unknown>)["parent_thread_id"] === "string";
}

function isForkCopy(state: CodexScanState, timestampMs: number) {
  if (!state.suppressingForkCopies) return false;
  if (timestampMs - state.forkCopyAnchorMs < FORK_COPY_MAX_GAP_MS) {
    state.forkCopyAnchorMs = timestampMs;
    return true;
  }
  state.suppressingForkCopies = false;
  state.lastUsageSignature = null;
  return false;
}

/**
 * Identified request-ledger entries report spending independently of context snapshots.
 * Legacy snapshots validate request deltas against cumulative counters.
 */
export function parseCodexLine(line: string, state: CodexScanState) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return [] satisfies readonly UsageRecord[];
  }
  return parseCodexRecord(parsed, state) satisfies readonly UsageRecord[];
}

function parseCodexRecord(parsed: unknown, state: CodexScanState) {
  if (typeof parsed !== "object" || parsed === null) return [] satisfies readonly UsageRecord[];

  const record = parsed as Record<string, unknown>;
  const payload = record["payload"];
  if (typeof payload !== "object" || payload === null) return [] satisfies readonly UsageRecord[];
  const payloadRecord = payload as Record<string, unknown>;
  const payloadType = payloadRecord["type"];

  if (record["type"] === "session_meta") {
    if (state.sawSessionMeta) return [] satisfies readonly UsageRecord[];
    state.sawSessionMeta = true;
    const id = payloadRecord["id"] ?? payloadRecord["session_id"];
    if (typeof id === "string") state.sessionId = id;
    if (typeof payloadRecord["model_provider"] === "string") {
      state.modelProvider = payloadRecord["model_provider"];
    }
    const metaTimestampMs = parseTimestampMs(record["timestamp"]);
    if (metaTimestampMs !== null && isForkedSessionMeta(payloadRecord)) {
      state.suppressingForkCopies = true;
      state.forkCopyAnchorMs = metaTimestampMs;
    }
    return [] satisfies readonly UsageRecord[];
  }

  if (record["type"] === "turn_context") {
    state.requestLedgerActive = false;
    if (typeof payloadRecord["model"] === "string") state.model = payloadRecord["model"];
    state.turnId =
      typeof payloadRecord["turn_id"] === "string" &&
      typeof payloadRecord["model"] === "string" &&
      payloadRecord["model"].length > 0
        ? payloadRecord["turn_id"]
        : "";
    return [] satisfies readonly UsageRecord[];
  }

  if (record["type"] === "token_usage_record") {
    const timestampMs = parseTimestampMs(record["timestamp"]);
    const usage = readCodexTokenUsage(payloadRecord["usage"]);
    if (timestampMs === null || usage === null || state.model.length === 0)
      return [] satisfies readonly UsageRecord[];
    if (isForkCopy(state, timestampMs)) return [] satisfies readonly UsageRecord[];
    const responseId = payloadRecord["response_id"];
    if (typeof responseId === "string" && responseId.length > 0) {
      const pending = state.unreportedRequests ?? [];
      state.requestLedgerActive = true;
      for (const request of pending) {
        state.lastCumulativeUsage = advanceCodexUsage(state.lastCumulativeUsage, request.usage);
      }
      state.lastCumulativeUsage = advanceCodexUsage(state.lastCumulativeUsage, usage);
      dateCodexBaseline(state, timestampMs);
      delete state.unreportedRequests;
      return [
        ...pending.map((request) => codexRequestRecord(state, request.usage, request)),
        {
          ...codexRequestRecord(state, usage, codexAttribution(state, timestampMs)),
          dedupeKey: JSON.stringify(["codex", state.sessionId, responseId]),
        },
      ] satisfies readonly UsageRecord[];
    }
    state.requestLedgerActive = false;
    (state.unreportedRequests ??= []).push({ ...codexAttribution(state, timestampMs), usage });
    return [] satisfies readonly UsageRecord[];
  }

  if (payloadType === "thread_settings_applied") {
    state.sawThreadSettings = true;
    const settings = payloadRecord["thread_settings"];
    if (typeof settings === "object" && settings !== null) {
      state.speed = codexSpeed((settings as Record<string, unknown>)["service_tier"]);
    }
    return [] satisfies readonly UsageRecord[];
  }

  if (payloadType !== "token_count") return [] satisfies readonly UsageRecord[];

  const info = payloadRecord["info"];
  if (typeof info !== "object" || info === null) return [] satisfies readonly UsageRecord[];
  const infoRecord = info as Record<string, unknown>;

  const timestampMs = parseTimestampMs(record["timestamp"]);
  if (timestampMs === null || state.model.length === 0) return [] satisfies readonly UsageRecord[];

  const last = readCodexTokenUsage(infoRecord["last_token_usage"]);
  const rawCumulative = infoRecord["total_token_usage"];
  const hasCumulative = rawCumulative !== undefined && rawCumulative !== null;
  const cumulative = hasCumulative ? readCodexTokenUsage(rawCumulative) : null;

  if (isForkCopy(state, timestampMs)) {
    const signature = last === null ? null : JSON.stringify(last);
    if (cumulative !== null) rebaseCodexUsage(state, cumulative, timestampMs);
    else if (!hasCumulative && last !== null && signature !== state.lastUsageSignature) {
      state.lastCumulativeUsage = advanceCodexUsage(state.lastCumulativeUsage, last);
      dateCodexBaseline(state, timestampMs);
    }
    state.lastUsageSignature = signature;
    return [] satisfies readonly UsageRecord[];
  }

  if (state.requestLedgerActive) {
    if (cumulative !== null) rebaseCodexUsage(state, cumulative, timestampMs);
    return [] satisfies readonly UsageRecord[];
  }

  const previous = state.lastCumulativeUsage;
  const latestCumulativeAtMs = state.latestCumulativeAtMs;
  const pending = state.unreportedRequests;
  if (cumulative !== null) rebaseCodexUsage(state, cumulative, timestampMs);
  if (last === null || (hasCumulative && cumulative === null)) {
    state.malformedRecords += 1;
    return [] satisfies readonly UsageRecord[];
  }

  if (last.input_tokens + last.output_tokens === 0) {
    state.lastUsageSignature = null;
    return [] satisfies readonly UsageRecord[];
  }

  if (
    cumulative !== null &&
    previous !== null &&
    CODEX_USAGE_FIELDS.every((key) => cumulative[key] === previous[key])
  ) {
    return [] satisfies readonly UsageRecord[];
  }

  if (last.total_tokens !== last.input_tokens + last.output_tokens) {
    state.malformedRecords += 1;
    return [] satisfies readonly UsageRecord[];
  }

  const signature = JSON.stringify(last);
  let unreported: readonly CodexUnreportedRequest[] = [];
  if (cumulative !== null) {
    const restarted = CODEX_USAGE_FIELDS.every((key) => cumulative[key] === last[key]);
    const sequenceStart = JSON.stringify([timestampMs, last]);
    if (restarted && sequenceStart === state.sequenceStartSignature) {
      state.lastCumulativeUsage = previous;
      if (latestCumulativeAtMs === undefined) delete state.latestCumulativeAtMs;
      return [] satisfies readonly UsageRecord[];
    }
    const lowered =
      previous !== null && CODEX_USAGE_FIELDS.some((key) => cumulative[key] < previous[key]);
    const rewound =
      lowered && latestCumulativeAtMs !== undefined && timestampMs > latestCumulativeAtMs;
    const reconciled =
      previous === null || rewound
        ? readCodexTokenUsage(
            Object.fromEntries(CODEX_USAGE_FIELDS.map((key) => [key, cumulative[key] - last[key]])),
          ) !== null
        : CODEX_USAGE_FIELDS.every((key) => cumulative[key] - previous[key] === last[key]);
    if (!restarted && !reconciled) {
      const bridged = unreportedRequests(previous, cumulative, last, pending);
      if (bridged === null) {
        const replayed =
          latestCumulativeAtMs !== undefined &&
          (timestampMs < latestCumulativeAtMs ||
            (timestampMs === latestCumulativeAtMs &&
              lowered &&
              cumulative.input_tokens + cumulative.output_tokens > 0));
        if (replayed) {
          state.lastCumulativeUsage = previous;
          if (pending !== undefined) state.unreportedRequests = pending;
        }
        state.malformedRecords += 1;
        return [] satisfies readonly UsageRecord[];
      }
      unreported = bridged;
    } else if (!restarted && rewound) {
      state.malformedRecords += discardedRequests(pending, last);
    }
    if (restarted) state.sequenceStartSignature = sequenceStart;
  } else {
    if (signature === state.lastUsageSignature) return [] satisfies readonly UsageRecord[];
    const advanced = advanceCodexUsage(previous, last);
    if (advanced === null) {
      state.malformedRecords += 1;
      return [] satisfies readonly UsageRecord[];
    }
    state.lastCumulativeUsage = advanced;
    dateCodexBaseline(state, timestampMs);
  }
  state.lastUsageSignature = signature;

  return [
    ...unreported.map((request) => codexRequestRecord(state, request.usage, request)),
    codexRequestRecord(state, last, codexAttribution(state, timestampMs)),
  ] satisfies readonly UsageRecord[];
}

function codexAttribution(state: CodexScanState, timestampMs: number) {
  return {
    timestampMs,
    model: state.model,
    turnId: state.turnId,
    speed: state.speed,
    sawThreadSettings: state.sawThreadSettings,
  };
}

function codexRequestRecord(
  state: CodexScanState,
  usage: CodexTokenUsage,
  { timestampMs, model, turnId, speed, sawThreadSettings }: CodexRequestAttribution,
) {
  const inputTokens = usage.input_tokens;
  const cachedInputTokens = usage.cached_input_tokens;
  const cacheCreationTokens = usage.cache_write_input_tokens;
  const outputTokens = usage.output_tokens;

  const totals: UsageTokenTotals = {
    uncachedInputTokens: inputTokens - cachedInputTokens - cacheCreationTokens,
    cachedInputTokens,
    cacheCreationTokens,
    outputTokens,
    reasoningTokens: usage.reasoning_output_tokens,
  };

  return {
    provider: "codex",
    timestampMs,
    model,
    sessionId: state.sessionId,
    totals,
    reportedCostUsd: null,
    speed,
    ...(!sawThreadSettings &&
    state.modelProvider === "openai" &&
    state.sessionId.length > 0 &&
    turnId.length > 0
      ? { unresolvedServiceTierTurnId: turnId }
      : {}),
    dedupeKey: null,
  } satisfies UsageRecord;
}

function codexSpeed(serviceTier: unknown) {
  if (serviceTier === "priority" || serviceTier === "fast") return "fast";
  if (serviceTier === "ultrafast") return "ultrafast";
  return "standard";
}

export const codexUsageFormat: TranscriptUsageFormat<CodexScanState> = {
  selectFields: {
    type: true,
    timestamp: true,
    payload: {
      type: true,
      id: true,
      session_id: true,
      model_provider: true,
      turn_id: true,
      response_id: true,
      model: true,
      thread_settings: { service_tier: true },
      forked_from_id: true,
      source: { subagent: { thread_spawn: { parent_thread_id: true } } },
      info: { last_token_usage: true, total_token_usage: true },
      usage: true,
    },
  },
  usageMarkers: [
    '"token_count"',
    '"token_usage_record"',
    '"turn_context"',
    '"thread_settings_applied"',
    '"session_meta"',
  ],
  parseLine: parseCodexLine,
  parseProjected: parseCodexRecord,
  state: { initial: initialCodexScanState, schema: CodexScanState },
  readMalformedRecords: (state) => state.malformedRecords,
  sharedSessionsAcrossFiles: true,
};

export const codexUsageReader: ProviderUsageReader<
  CodexSettings,
  Path.Path | CodexUsageHistory.CodexUsageHistory
> = {
  kind: "transcripts",
  provider: "codex",
  format: codexUsageFormat,
  resolveServiceTiers: Effect.fn("codexUsageReader.resolveServiceTiers")(function* (records) {
    const history = yield* CodexUsageHistory.CodexUsageHistory;
    const requests = new Map<CodexUsageHistory.CodexUsageHistoryRequest, UsageRecord>();
    for (const record of records) {
      if (record.unresolvedServiceTierTurnId === undefined) continue;
      requests.set(
        {
          sessionId: record.sessionId,
          nativeTurnId: record.unresolvedServiceTierTurnId,
          model: record.model,
        },
        record,
      );
    }
    const resolved = yield* history.resolve([...requests.keys()]).pipe(
      Effect.catchTags({
        CodexUsageHistoryReadError: () =>
          Effect.succeed(new Map<CodexUsageHistory.CodexUsageHistoryRequest, UsageSpeed>()),
      }),
    );
    const speeds = new Map<UsageRecord, UsageSpeed>();
    for (const [request, speed] of resolved) {
      const record = requests.get(request);
      if (record !== undefined) speeds.set(record, speed);
    }
    return speeds;
  }),
  directories: Effect.fn("codexUsageReader.directories")(function* ({ config, environment }) {
    if (config === undefined) return [];
    const path = yield* Path.Path;
    const environmentHome = environment.CODEX_HOME?.trim();
    const layout = yield* resolveCodexHomeLayout(
      config.setupMode !== "managed" && !config.homePath.trim() && environmentHome
        ? { ...config, homePath: environmentHome }
        : config,
    );
    return [{ dir: path.resolve(layout.sharedHomePath, "sessions") }];
  }),
};
