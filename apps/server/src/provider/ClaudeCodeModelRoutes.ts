import {
  type ModelInfo as ClaudeModelInfo,
  resolveSettings as resolveClaudeSettings,
  type SettingSource,
  type Settings as ClaudeSdkSettings,
} from "@anthropic-ai/claude-agent-sdk";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";

import { claudeLocalSettingsDirectory } from "./Drivers/ClaudeHome.ts";
import { type ClaudeModelCatalog, withClaudeCodeModelRoutes } from "./ClaudeModelCatalog.ts";

const MODEL_SETTINGS_ENV_PREFIXES = [
  "ANTHROPIC_",
  "CLAUDE_CODE_USE_",
  "AWS_",
  "CLOUD_ML_",
  "VERTEX_",
];

function claudeModelSettingsKey(settings: ClaudeSdkSettings): string {
  const sortedEntries = (record: Readonly<Record<string, string | undefined>> | undefined) =>
    Object.entries(record ?? {}).toSorted(([a], [b]) => a.localeCompare(b));
  return JSON.stringify([
    settings.availableModels ?? null,
    sortedEntries(settings.modelOverrides),
    sortedEntries(settings.env).filter(([name]) =>
      MODEL_SETTINGS_ENV_PREFIXES.some((prefix) => name.startsWith(prefix)),
    ),
  ]);
}

const NO_MODEL_SETTINGS_KEY = claudeModelSettingsKey({});

class ClaudeModelSettingsReadError extends Schema.TaggedError<ClaudeModelSettingsReadError>()(
  "ClaudeModelSettingsReadError",
  { cause: Schema.Defect() },
) {}

export const resolveClaudeModelSettingsKey = Effect.fn("resolveClaudeModelSettingsKey")(function* (
  settingSources: ReadonlyArray<SettingSource>,
  cwd: string | null,
) {
  const localDirectory = cwd === null ? null : yield* claudeLocalSettingsDirectory(cwd);
  if (localDirectory !== null && localDirectory !== cwd) {
    const rootLocal = yield* Effect.tryPromise({
      try: () => resolveClaudeSettings({ cwd: localDirectory, settingSources: ["local"] }),
      catch: (cause) => new ClaudeModelSettingsReadError({ cause }),
    }).pipe(
      Effect.map(({ sources }) => sources.find(({ source }) => source === "local")?.settings),
      Effect.orElseSucceed(() => undefined),
    );
    if (claudeModelSettingsKey(rootLocal ?? {}) !== NO_MODEL_SETTINGS_KEY) return undefined;
  }
  return yield* Effect.tryPromise({
    try: () =>
      resolveClaudeSettings({
        ...(cwd === null ? {} : { cwd }),
        settingSources: [...settingSources],
      }),
    catch: (cause) => new ClaudeModelSettingsReadError({ cause }),
  }).pipe(
    Effect.map(({ effective }) => claudeModelSettingsKey(effective)),
    Effect.orElseSucceed(() => undefined),
  );
});

type ReportedModel = Pick<ClaudeModelInfo, "value" | "resolvedModel">;

/**
 * Claude Code's reported model ids, applied to a turn only where its cwd resolves model settings
 * as the probe's cwd did. `settle` releases turns waiting for the first probe, whatever its outcome.
 */
export const makeClaudeCodeModelRoutes = Effect.fn("makeClaudeCodeModelRoutes")(function* (
  settingsKey: (cwd: string | null) => Effect.Effect<string | undefined>,
  probeCwd: string,
) {
  const firstProbeSettled = yield* Deferred.make<void>();
  const reported = yield* Ref.make<{
    readonly models: ReadonlyArray<ReportedModel>;
    readonly settingsKey: string | undefined;
  }>({ models: [], settingsKey: undefined });
  return {
    record: Effect.fn("ClaudeCodeModelRoutes.record")(function* (
      models: ReadonlyArray<ReportedModel>,
    ) {
      yield* Ref.set(reported, { models, settingsKey: yield* settingsKey(probeCwd) });
    }),
    settle: Deferred.succeed(firstProbeSettled, undefined).pipe(Effect.asVoid),
    route: Effect.fn("ClaudeCodeModelRoutes.route")(function* (
      base: ClaudeModelCatalog,
      cwd: string | null,
      launchSettings?: ClaudeSdkSettings,
    ) {
      yield* Deferred.await(firstProbeSettled).pipe(
        Effect.timeoutOption("2 minutes"),
        Effect.andThen(Deferred.succeed(firstProbeSettled, undefined)),
      );
      if (claudeModelSettingsKey(launchSettings ?? {}) !== NO_MODEL_SETTINGS_KEY) return base;
      const { models, settingsKey: probeKey } = yield* Ref.get(reported);
      const routed = withClaudeCodeModelRoutes(base, models);
      if (routed === base || probeKey === undefined) return base;
      return (yield* settingsKey(cwd)) === probeKey ? routed : base;
    }),
  };
});
