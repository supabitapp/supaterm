// @effect-diagnostics-next-line nodeBuiltinImport:off -- the SDK's spawn hook returns a Node child process.
import * as NodeChildProcess from "node:child_process";

import { resolveProviderProbeTimeoutMs } from "@supaterm/provider-core/server/snapshotProbe";
import {
  type ClaudeSettings,
  type ModelCapabilities,
  type ServerProvider,
  type ServerProviderModel,
  type ServerProviderSlashCommand,
  type ServerProviderTranscription,
  type ServerProviderResetCredits,
} from "@supaterm/contracts";
import * as Cache from "effect/Cache";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { createModelCapabilities } from "@supaterm/shared/model";
import { envTrampoline, supportsEnvChdir } from "@supaterm/shared/envTrampoline";
import * as HostProcess from "@supaterm/shared/HostProcess";
import * as SpawnWorker from "../process/SpawnWorker.ts";
import { resolveSpawnCommand } from "@supaterm/shared/shell";
import {
  query as claudeQuery,
  type ModelInfo as ClaudeModelInfo,
  type SlashCommand as ClaudeSlashCommand,
  type SDKControlGetUsageResponse,
  type SettingSource,
  type SpawnOptions as ClaudeSpawnOptions,
} from "@anthropic-ai/claude-agent-sdk";

import {
  buildServerProvider,
  COMPACT_SLASH_COMMAND,
  DEFAULT_TIMEOUT_MS,
  isCommandMissingCause,
  parseCliVersionResult,
  providerModelsFromSettings,
  providerProbeEnvironment,
  spawnAndCollect,
  type ServerProviderDraft,
} from "@supaterm/provider-core/server/snapshotProbe";
import { resolveClaudeSdkExecutablePath } from "./Drivers/ClaudeExecutable.ts";
import {
  claudeSignedOutMessage,
  hasClaudeManagedMcpConfig,
  makeClaudeEnvironment,
} from "./Drivers/ClaudeHome.ts";
import {
  customClaudeApiEndpointHost,
  discoverClaudeSkills,
  readClaudeSettingsEnv,
} from "./Drivers/ClaudeSkills.ts";
import type { ProviderWorkspaceSnapshot } from "@supaterm/provider-core/server/driver";
import { makeUnavailableUsageLimits } from "@supaterm/provider-core/server/usageLimits";
import {
  type ClaudeScopedLimitNames,
  claudeUsageResponseToLimits,
  recordClaudeUsageResponse,
} from "./claudeUsageLimits.ts";
import {
  BUNDLED_CLAUDE_MODEL_CATALOG,
  CLAUDE_EFFORT_LEVELS,
  capClaudeCatalogEffort,
  type ClaudeEffortCapSource,
  type ClaudeEffortLevel,
  type ClaudeModelCatalog,
  claudeReportedModels,
  formatClaudeVersionUpgradeMessage,
  resolveClaudeModelsForVersion,
  resolveClaudeUpdateRequiredModels,
  withUltracodeToggle,
} from "./ClaudeModelCatalog.ts";

const DEFAULT_CLAUDE_MODEL_CAPABILITIES: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [],
});

function claudeProviderModels(
  builtInModels: ReadonlyArray<ServerProviderModel>,
  customModels: ClaudeSettings["customModels"],
): ReadonlyArray<ServerProviderModel>;
function claudeProviderModels(
  builtInModels: ReadonlyArray<ServerProviderModel>,
  customModels: ClaudeSettings["customModels"],
) {
  return providerModelsFromSettings(
    builtInModels,
    customModels,
    DEFAULT_CLAUDE_MODEL_CAPABILITIES,
  ).map((model) =>
    model.isCustom ? { ...model, capabilities: withUltracodeToggle(model.capabilities) } : model,
  ) satisfies ReadonlyArray<ServerProviderModel>;
}

const CLAUDE_PRESENTATION = {
  displayName: "Claude",
  showInteractionModeToggle: true,
  reportsContextWindow: true,
} as const;
function toTitleCaseWords(value: string) {
  const parts: Array<string> = [];
  for (const part of value.split(/[\s_-]+/g)) {
    if (part.length > 0) {
      parts.push(part[0]!.toUpperCase() + part.slice(1).toLowerCase());
    }
  }
  return parts.join(" ");
}

function claudeSubscriptionLabel(subscriptionType: string | undefined) {
  const normalized = subscriptionType?.toLowerCase().replace(/[\s_-]+/g, "");
  if (!normalized) return undefined;

  switch (normalized) {
    case "claudemaxsubscription":
    case "claudemax5xsubscription":
      return "Max";
    case "claudemax20xsubscription":
      return "Ultra";
    case "claudeenterprisesubscription":
      return "Enterprise";
    case "claudeteamsubscription":
      return "Team";
    case "claudeprosubscription":
      return "Pro";
    case "claudefreesubscription":
      return "Free";
    case "max":
    case "maxplan":
    case "max5":
      return "Max";
    case "max20":
      return "Ultra";
    case "enterprise":
      return "Enterprise";
    case "team":
      return "Team";
    case "pro":
      return "Pro";
    case "free":
      return "Free";
    default:
      return toTitleCaseWords(subscriptionType!);
  }
}

function normalizeClaudeAuthMethod(authMethod: string | undefined) {
  const normalized = authMethod?.toLowerCase().replace(/[\s_-]+/g, "");
  if (!normalized) return undefined;
  if (
    normalized === "apikey" ||
    normalized === "anthropicapikey" ||
    normalized === "anthropicauthtoken"
  ) {
    return "apiKey";
  }
  return undefined;
}

function formatClaudeSubscriptionAuthLabel(subscriptionType: string) {
  const subscriptionLabel =
    claudeSubscriptionLabel(subscriptionType) ?? toTitleCaseWords(subscriptionType);
  const normalized = subscriptionLabel.toLowerCase().replace(/[\s_-]+/g, "");

  if (normalized.startsWith("claude") && normalized.endsWith("subscription")) {
    return subscriptionLabel;
  }
  if (normalized.startsWith("claude")) {
    return `${subscriptionLabel} Subscription`;
  }
  if (normalized.endsWith("subscription")) {
    return `Claude ${subscriptionLabel}`;
  }
  return `Claude ${subscriptionLabel} Subscription`;
}

function hasApiKey(apiKeySource: string | undefined) {
  return Boolean(apiKeySource) && apiKeySource !== "none";
}

function claudeAuthMetadata(input: {
  readonly subscriptionType: string | undefined;
  readonly authMethod: string | undefined;
  readonly apiKeySource: string | undefined;
}) {
  if (normalizeClaudeAuthMethod(input.authMethod) === "apiKey" || hasApiKey(input.apiKeySource)) {
    return {
      type: "apiKey",
      label: "Claude API Key",
    };
  }

  if (input.subscriptionType) {
    return {
      type: input.subscriptionType,
      label: formatClaudeSubscriptionAuthLabel(input.subscriptionType),
    };
  }

  return undefined;
}

function apiProviderAuthMetadata(apiProvider: string | undefined) {
  return apiProvider === "bedrock" ? { type: "bedrock", label: "Amazon Bedrock" } : undefined;
}

function claudeAuthStatus(
  capabilities: Pick<
    ClaudeCapabilitiesProbe,
    "email" | "subscriptionType" | "tokenSource" | "apiKeySource" | "apiProvider"
  >,
): "authenticated" | "unauthenticated";
function claudeAuthStatus(
  capabilities: Pick<
    ClaudeCapabilitiesProbe,
    "email" | "subscriptionType" | "tokenSource" | "apiKeySource" | "apiProvider"
  >,
) {
  if (capabilities.apiProvider !== undefined && capabilities.apiProvider !== "firstParty") {
    return "authenticated" satisfies "authenticated" | "unauthenticated";
  }
  if (capabilities.tokenSource !== "none")
    return "authenticated" satisfies "authenticated" | "unauthenticated";
  return (
    hasApiKey(capabilities.apiKeySource) || capabilities.email || capabilities.subscriptionType
      ? "authenticated"
      : "unauthenticated"
  ) satisfies "authenticated" | "unauthenticated";
}

const CLAUDE_SUBSCRIPTION_TOKEN_SOURCES: ReadonlySet<string> = new Set([
  "claude.ai",
  "CLAUDE_CODE_OAUTH_TOKEN",
]);

function claudeTranscriptionStatus(
  capabilities: Pick<
    ClaudeCapabilitiesProbe,
    "subscriptionType" | "tokenSource" | "apiKeySource" | "apiProvider"
  >,
  customApiEndpoint: boolean,
) {
  const firstParty =
    capabilities.apiProvider === undefined || capabilities.apiProvider === "firstParty";
  const subscriptionLogin =
    capabilities.subscriptionType !== undefined ||
    (capabilities.tokenSource !== undefined &&
      CLAUDE_SUBSCRIPTION_TOKEN_SOURCES.has(capabilities.tokenSource));
  const apiKey = capabilities.apiKeySource !== undefined && capabilities.apiKeySource !== "none";
  return (
    firstParty && !customApiEndpoint && subscriptionLogin && !apiKey
      ? { status: "ready" }
      : { status: "unavailable", reason: "unsupportedLogin" }
  ) satisfies ServerProviderTranscription;
}

const CAPABILITIES_PROBE_TIMEOUT_MS = 25_000;
const CAPABILITIES_PROBE_TTL = Duration.minutes(5);
const CLAUDE_VERSION_CHECK_TIMEOUT_MS = 20_000;

const CLAUDE_CAPABILITIES_PROBE_SETTING_SOURCES = [
  "user",
  "project",
  "local",
] as const satisfies ReadonlyArray<SettingSource>;

/**
 * The SDK's own spawn stats the executable and hands libuv the workspace as cwd, so a mount
 * that stops answering freezes the server. `env` enters the cwd and finds the CLI in the child.
 * A shell would not do: dash drops the exported Bash functions a launcher may call.
 */
export function spawnClaudeProbeThroughEnv({
  command,
  args,
  cwd,
  env,
  signal,
}: ClaudeSpawnOptions) {
  const launch = envTrampoline(command, args, cwd) ?? { command, args, cwd };
  return NodeChildProcess.spawn(launch.command, launch.args, {
    ...("cwd" in launch ? { cwd: launch.cwd } : {}),
    env,
    signal,
    stdio: ["pipe", "pipe", "ignore"],
  });
}

function spawnClaudeProbeOffThread({ command, args, cwd, env, signal }: ClaudeSpawnOptions) {
  const child = SpawnWorker.spawnPiped(command, args, { cwd, env, signal, windowsHide: true });
  child.stderr.resume();
  return child;
}

export function buildClaudeCapabilitiesProbeQueryOptions(input: {
  readonly executablePath: string;
  readonly abortController: AbortController;
  readonly environment: NodeJS.ProcessEnv;
  readonly cwd: string | undefined;
  readonly managedMcpConfig: boolean;
  readonly spawnVia: "env" | "launcher-thread" | undefined;
}) {
  return {
    ...(input.spawnVia === "env" ? { spawnClaudeCodeProcess: spawnClaudeProbeThroughEnv } : {}),
    ...(input.spawnVia === "launcher-thread"
      ? { spawnClaudeCodeProcess: spawnClaudeProbeOffThread }
      : {}),
    persistSession: false,
    pathToClaudeCodeExecutable: input.executablePath,
    abortController: input.abortController,
    settingSources: [...CLAUDE_CAPABILITIES_PROBE_SETTING_SOURCES],
    settings: { disableAllHooks: true },
    allowedTools: [],
    mcpServers: {},
    ...(input.managedMcpConfig ? {} : { strictMcpConfig: true }),
    env: {
      ...providerProbeEnvironment(input.environment),
      ENABLE_CLAUDEAI_MCP_SERVERS: "false",
      FORCE_CODE_TERMINAL: undefined,
      CLAUDE_CODE_AUTO_CONNECT_IDE: "0",
      CLAUDE_CODE_IDE_SKIP_AUTO_INSTALL: "1",
    },
    ...(input.cwd ? { cwd: input.cwd } : {}),
    stderr: () => {},
  };
}

function nonEmptyProbeString(value: string) {
  const candidate = value.trim();
  return candidate ? candidate : undefined;
}

export type ClaudeCapabilitiesProbe = {
  readonly email: string | undefined;
  readonly workspaceId?: string | undefined;
  readonly subscriptionType: string | undefined;
  readonly tokenSource: string | undefined;

  readonly apiKeySource: string | undefined;
  /**
   * Active API backend reported by the SDK's `AccountInfo`. Anthropic OAuth
   * login only applies when `"firstParty"`; for Amazon Bedrock (`"bedrock"`)
   * the subscription/token fields are absent and auth is external AWS creds.
   */
  readonly apiProvider: string | undefined;
  readonly fastModeDisabledReason?: string;
  readonly slashCommands: ReadonlyArray<ServerProviderSlashCommand>;
  readonly models?: ReadonlyArray<ClaudeModelInfo>;
  /**
   * Subscription windows from the SDK's `get_usage` control request, or
   * `undefined` when the request itself failed. Absent windows on an
   * otherwise successful response mean the account has none (API key).
   */
  readonly usage?: Pick<SDKControlGetUsageResponse, "rate_limits_available" | "rate_limits">;
  readonly usageCheckedAt?: string;
  /** Each settings source's `maxEffortLevel` caps; Claude Code clamps every higher effort. */
  readonly effortCapSources?: ReadonlyArray<ClaudeEffortCapSource>;
};

type ClaudeSettingsQuery = {
  readonly getSettings?: () => Promise<{
    readonly effective?: unknown;
    readonly sources?: unknown;
  }>;
};

function parseClaudeMaxEffortLevel(value: unknown) {
  return CLAUDE_EFFORT_LEVELS.find((level) => level === value);
}

function parseClaudeModelMaxEffortLevels(modelSettings: unknown) {
  if (!modelSettings || typeof modelSettings !== "object") return undefined;
  const levels = new Map<string, ClaudeEffortLevel>();
  for (const [model, settings] of Object.entries(modelSettings)) {
    const level = parseClaudeMaxEffortLevel(
      settings && typeof settings === "object"
        ? (settings as { readonly maxEffortLevel?: unknown }).maxEffortLevel
        : undefined,
    );
    if (level) levels.set(model, level);
  }
  return levels.size > 0 ? levels : undefined;
}

function parseClaudeEffortCapSource(settings: unknown) {
  if (!settings || typeof settings !== "object") return undefined;
  const { maxEffortLevel, modelSettings } = settings as {
    readonly maxEffortLevel?: unknown;
    readonly modelSettings?: unknown;
  };
  const level = parseClaudeMaxEffortLevel(maxEffortLevel);
  const modelMaxEffortLevels = parseClaudeModelMaxEffortLevels(modelSettings);
  return level || modelMaxEffortLevels
    ? {
        ...(level ? { maxEffortLevel: level } : {}),
        ...(modelMaxEffortLevels ? { modelMaxEffortLevels } : {}),
      }
    : undefined;
}

function parseClaudeEffortCapSources(
  settings: { readonly effective?: unknown; readonly sources?: unknown } | undefined,
) {
  const sources = Array.isArray(settings?.sources)
    ? settings.sources.flatMap((source) => {
        const parsed = parseClaudeEffortCapSource(
          source && typeof source === "object"
            ? (source as { readonly settings?: unknown }).settings
            : undefined,
        );
        return parsed ? [parsed] : [];
      })
    : [parseClaudeEffortCapSource(settings?.effective)].filter((source) => source !== undefined);
  return sources.length > 0 ? sources : undefined;
}

function parseClaudeInitializationCommands(
  commands: ReadonlyArray<ClaudeSlashCommand> | undefined,
) {
  return dedupeSlashCommands(
    (commands ?? []).flatMap((command) => {
      const name = nonEmptyProbeString(command.name);
      if (!name) {
        return [];
      }

      const description = nonEmptyProbeString(command.description);
      const argumentHint = nonEmptyProbeString(command.argumentHint);

      return [
        {
          name,
          ...(description ? { description } : {}),
          ...(argumentHint ? { input: { hint: argumentHint } } : {}),
        } satisfies ServerProviderSlashCommand,
      ];
    }),
  );
}

function dedupeSlashCommands(
  commands: ReadonlyArray<ServerProviderSlashCommand>,
): ReadonlyArray<ServerProviderSlashCommand>;
function dedupeSlashCommands(commands: ReadonlyArray<ServerProviderSlashCommand>) {
  const commandsByName = new Map<string, ServerProviderSlashCommand>();

  for (const command of commands) {
    const name = nonEmptyProbeString(command.name);
    if (!name) {
      continue;
    }

    const key = name.toLowerCase();
    const existing = commandsByName.get(key);
    if (!existing) {
      commandsByName.set(key, {
        ...command,
        name,
      });
      continue;
    }

    commandsByName.set(key, {
      ...existing,
      ...(existing.description
        ? {}
        : command.description
          ? { description: command.description }
          : {}),
      ...(existing.input?.hint
        ? {}
        : command.input?.hint
          ? { input: { hint: command.input.hint } }
          : {}),
    });
  }

  return [...commandsByName.values()] satisfies ReadonlyArray<ServerProviderSlashCommand>;
}

function waitForAbortSignal(signal: AbortSignal) {
  if (signal.aborted) {
    return Promise.resolve() satisfies Promise<void>;
  }
  return new Promise((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  }) satisfies Promise<void>;
}

function claudeGatewayDiscoveryGraceMs(environment: Readonly<Record<string, unknown>>) {
  const enabled = String(environment.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY ?? "")
    .trim()
    .toLowerCase();
  if (!enabled || enabled === "0" || enabled === "false") return 0;
  if (!String(environment.ANTHROPIC_BASE_URL ?? "").trim()) return 0;
  const configured = Number(environment.CLAUDE_CODE_GATEWAY_MODEL_DISCOVERY_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : 3_000;
}

export const ClaudeProbeQuery = Context.Reference<typeof claudeQuery>(
  "supaterm/provider/ClaudeProvider/ClaudeProbeQuery",
  { defaultValue: () => claudeQuery },
);

/**
 * We pass a never-yielding AsyncIterable as the prompt so that no user message is ever written
 * to the subprocess stdin. This means the Claude Code subprocess completes its local
 * initialization IPC (returning account info and slash commands) but never starts an API
 * request to Anthropic.
 */
const probeClaudeCapabilities = (
  claudeSettings: ClaudeSettings,
  environment?: NodeJS.ProcessEnv,
  cwd?: string,
  includeStatus = true,
) => {
  const abort = new AbortController();
  const abortProbe = Effect.sync(() => {
    if (!abort.signal.aborted) abort.abort();
  });
  return Effect.gen(function* () {
    const claudeEnvironment = yield* makeClaudeEnvironment(claudeSettings, environment);
    const executablePath = yield* resolveClaudeSdkExecutablePath(
      claudeSettings.binaryPath,
      claudeEnvironment,
    );
    const managedMcpConfig = yield* hasClaudeManagedMcpConfig();
    const query = yield* ClaudeProbeQuery;
    const graceMs = includeStatus
      ? claudeGatewayDiscoveryGraceMs({
          ...claudeEnvironment,
          ...(yield* readClaudeSettingsEnv(claudeSettings, cwd, claudeEnvironment)),
        })
      : 0;
    const platform = yield* HostProcess.Platform;
    const spawnVia =
      platform === "win32"
        ? "launcher-thread"
        : platform === "linux" && (yield* Effect.promise(supportsEnvChdir))
          ? "env"
          : undefined;
    return yield* Effect.tryPromise(async () => {
      const q = query({
        // oxlint-disable-next-line require-yield -- Never yield; we only need initialization data, not a conversation. This prevents any prompt from reaching the Anthropic API.
        prompt: (async function* () {
          await waitForAbortSignal(abort.signal);
        })(),
        options: buildClaudeCapabilitiesProbeQueryOptions({
          executablePath,
          abortController: abort,
          environment: claudeEnvironment,
          cwd,
          managedMcpConfig,
          spawnVia,
        }),
      });
      const init = await q.initializationResult();
      return { q, init, graceMs };
    });
  }).pipe(
    Effect.timeout(
      resolveProviderProbeTimeoutMs("claude", CAPABILITIES_PROBE_TIMEOUT_MS, environment),
    ),
    Effect.flatMap(({ q, init, graceMs }) =>
      Effect.gen(function* () {
        const usageCheckedAt = DateTime.formatIso(yield* DateTime.now);
        const { getSettings } = q as ClaudeSettingsQuery;
        const [usageResult, settingsResult] = yield* Effect.all(
          [
            includeStatus
              ? Effect.tryPromise(() =>
                  q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({
                    skipBehaviors: true,
                  }),
                ).pipe(Effect.timeout(DEFAULT_TIMEOUT_MS), Effect.result)
              : Effect.undefined,
            includeStatus && getSettings
              ? Effect.tryPromise(() => getSettings.call(q)).pipe(
                  Effect.timeout(DEFAULT_TIMEOUT_MS),
                  Effect.result,
                )
              : Effect.undefined,
          ],
          { concurrency: "unbounded" },
        );
        const usage =
          usageResult && Result.isSuccess(usageResult)
            ? {
                rate_limits_available: usageResult.success.rate_limits_available,
                rate_limits: usageResult.success.rate_limits,
              }
            : undefined;
        const effortCapSources = parseClaudeEffortCapSources(
          settingsResult && Result.isSuccess(settingsResult) ? settingsResult.success : undefined,
        );
        const account = init.account as
          | {
              readonly email?: string;
              readonly subscriptionType?: string;
              readonly tokenSource?: string;
              readonly apiKeySource?: string;
              readonly apiProvider?: string;
            }
          | undefined;
        return {
          email: account?.email,
          subscriptionType: account?.subscriptionType,
          tokenSource: account?.tokenSource,
          apiKeySource: account?.apiKeySource,
          apiProvider: account?.apiProvider,
          ...(init.fast_mode_disabled_reason === undefined
            ? {}
            : { fastModeDisabledReason: init.fast_mode_disabled_reason }),
          slashCommands: parseClaudeInitializationCommands(init.commands),
          ...(init.models?.length ? { models: init.models } : {}),
          ...(usage ? { usage, usageCheckedAt } : {}),
          ...(effortCapSources ? { effortCapSources } : {}),
        } satisfies ClaudeCapabilitiesProbe;
      }).pipe(
        Effect.tap(() =>
          graceMs > 0
            ? Effect.sleep(graceMs).pipe(Effect.andThen(abortProbe), Effect.forkDetach)
            : abortProbe,
        ),
      ),
    ),
    Effect.onError(() => abortProbe),
    Effect.tapError((error) =>
      Effect.logWarning("Claude capability probe failed.", {
        errorTag: error._tag,
        ...(Cause.isTimeoutError(error) ? { timeoutMs: CAPABILITIES_PROBE_TIMEOUT_MS } : {}),
      }),
    ),
  );
};

type ClaudeCapabilitiesProbeError = Effect.Error<ReturnType<typeof probeClaudeCapabilities>>;

export const makeClaudeCapabilitiesCache = Effect.fn("makeClaudeCapabilitiesCache")(function* <
  R,
>(input: {
  readonly key: string;
  readonly validateFallback: (
    capabilities: ClaudeCapabilitiesProbe,
  ) => Effect.Effect<boolean, never, R>;
  readonly lookup: () => Effect.Effect<ClaudeCapabilitiesProbe, ClaudeCapabilitiesProbeError, R>;
}) {
  const lastGood = yield* Ref.make<ClaudeCapabilitiesProbe | undefined>(undefined);
  const cache = yield* Cache.makeWith(
    () =>
      input.lookup().pipe(
        Effect.tap((capabilities) =>
          Ref.set(
            lastGood,
            claudeAuthStatus(capabilities) === "authenticated" ? capabilities : undefined,
          ),
        ),
        Effect.catch((error) =>
          Effect.gen(function* () {
            const previous = yield* Ref.getAndSet(lastGood, undefined);
            if (!previous || !(yield* input.validateFallback(previous))) return yield* error;
            const { usage: _staleUsage, ...capabilities } = previous;
            return yield* Effect.succeed<ClaudeCapabilitiesProbe>(capabilities);
          }),
        ),
      ),
    {
      capacity: 1,
      timeToLive: (exit) =>
        Exit.isSuccess(exit) &&
        exit.value.usage !== undefined &&
        claudeAuthStatus(exit.value) === "authenticated"
          ? CAPABILITIES_PROBE_TTL
          : Duration.zero,
    },
  );
  return {
    get: Cache.get(cache, input.key),
    invalidate: Cache.invalidateAll(cache),
  };
});

const runClaudeCommand = Effect.fn("runClaudeCommand")(function* (
  claudeSettings: ClaudeSettings,
  args: ReadonlyArray<string>,
  environment?: NodeJS.ProcessEnv,
  cwd?: string,
) {
  const claudeEnvironment = yield* makeClaudeEnvironment(claudeSettings, environment);
  const spawnCommand = yield* resolveSpawnCommand(claudeSettings.binaryPath, args, {
    env: claudeEnvironment,
  });
  const command = ChildProcess.make(spawnCommand.command, spawnCommand.args, {
    env: claudeEnvironment,
    shell: spawnCommand.shell,
    ...(cwd ? { cwd } : {}),
  });
  return yield* spawnAndCollect(claudeSettings.binaryPath, command);
});

export const probeClaudeWorkspaceSnapshot: (
  claudeSettings: ClaudeSettings,
  machineSnapshot: ServerProvider,
  cwd: string,
  environment?: NodeJS.ProcessEnv,
) => Effect.Effect<ProviderWorkspaceSnapshot, never, FileSystem.FileSystem | Path.Path> = Effect.fn(
  "probeClaudeWorkspaceSnapshot",
)(function* (
  claudeSettings: ClaudeSettings,
  machineSnapshot: ServerProvider,
  cwd: string,
  environment?: NodeJS.ProcessEnv,
) {
  if (!claudeSettings.enabled) return machineSnapshot;
  const skills = yield* discoverClaudeSkills(claudeSettings, cwd, environment);
  const fileSystem = yield* FileSystem.FileSystem;
  const cwdExists = yield* fileSystem.exists(cwd).pipe(Effect.orElseSucceed(() => true));
  const capabilities = cwdExists
    ? yield* probeClaudeCapabilities(claudeSettings, environment, cwd, false).pipe(
        Effect.orElseSucceed(() => undefined),
      )
    : undefined;
  return {
    ...machineSnapshot,
    skills,
    slashCommands: dedupeSlashCommands([
      COMPACT_SLASH_COMMAND,
      ...(capabilities?.slashCommands ?? []),
    ]),
    slashCommandsPending: cwdExists && !capabilities,
  };
});

export const checkClaudeProviderStatus: (
  claudeSettings: ClaudeSettings,
  resolveCapabilities?: (
    claudeSettings: ClaudeSettings,
  ) => Effect.Effect<ClaudeCapabilitiesProbe | undefined, ClaudeCapabilitiesProbeError>,
  environment?: NodeJS.ProcessEnv,
  cwd?: string,
  modelCatalog?: ClaudeModelCatalog,
  scopedLimitNames?: Ref.Ref<ClaudeScopedLimitNames>,
  resolveResetCredits?: (version: string) => Effect.Effect<ServerProviderResetCredits | undefined>,
) => Effect.Effect<
  ServerProviderDraft,
  never,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path
> = Effect.fn("checkClaudeProviderStatus")(function* (
  claudeSettings: ClaudeSettings,
  resolveCapabilities?: (
    claudeSettings: ClaudeSettings,
  ) => Effect.Effect<ClaudeCapabilitiesProbe | undefined, ClaudeCapabilitiesProbeError>,
  environment?: NodeJS.ProcessEnv,
  cwd?: string,
  modelCatalog: ClaudeModelCatalog = BUNDLED_CLAUDE_MODEL_CATALOG,
  scopedLimitNames?: Ref.Ref<ClaudeScopedLimitNames>,
  resolveResetCredits?: (version: string) => Effect.Effect<ServerProviderResetCredits | undefined>,
) {
  const resolvedEnvironment = environment ?? process.env;
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  const allModels = claudeProviderModels(
    modelCatalog.models.map((entry) => entry.model),
    claudeSettings.customModels,
  );

  if (!claudeSettings.enabled) {
    return buildServerProvider({
      presentation: CLAUDE_PRESENTATION,
      enabled: false,
      checkedAt,
      models: allModels,
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Claude is disabled in Supaterm settings.",
      },
    });
  }

  const versionProbe = yield* runClaudeCommand(
    claudeSettings,
    ["--version"],
    providerProbeEnvironment(resolvedEnvironment),
    cwd,
  ).pipe(
    Effect.timeoutOption(
      resolveProviderProbeTimeoutMs("claude", CLAUDE_VERSION_CHECK_TIMEOUT_MS, resolvedEnvironment),
    ),
    Effect.result,
  );

  if (Result.isFailure(versionProbe)) {
    const error = versionProbe.failure;
    yield* Effect.logWarning("Claude Agent CLI health check failed.", {
      errorTag: error._tag,
    });
    return buildServerProvider({
      presentation: CLAUDE_PRESENTATION,
      enabled: claudeSettings.enabled,
      checkedAt,
      models: allModels,
      probe: {
        installed: !isCommandMissingCause(error),
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: isCommandMissingCause(error)
          ? "Claude Agent CLI (`claude`) was not found on PATH."
          : "Failed to execute Claude Agent CLI health check.",
      },
    });
  }

  if (Option.isNone(versionProbe.success)) {
    return buildServerProvider({
      presentation: CLAUDE_PRESENTATION,
      enabled: claudeSettings.enabled,
      checkedAt,
      models: allModels,
      probe: {
        installed: true,
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message:
          "Claude Agent CLI is installed but failed to run. Timed out while running command.",
      },
    });
  }

  const version = versionProbe.success.value;
  const parsedVersion = parseCliVersionResult(version);
  if (version.code !== 0) {
    yield* Effect.logWarning("Claude Agent CLI version probe exited with a non-zero status.", {
      exitCode: version.code,
      stdoutLength: version.stdout.length,
      stderrLength: version.stderr.length,
    });
    return buildServerProvider({
      presentation: CLAUDE_PRESENTATION,
      enabled: claudeSettings.enabled,
      checkedAt,
      models: allModels,
      probe: {
        installed: true,
        version: parsedVersion,
        status: "error",
        auth: { status: "unknown" },
        message: "Claude Agent CLI is installed but failed to run.",
      },
    });
  }

  const updateRequiredModels = resolveClaudeUpdateRequiredModels(modelCatalog, parsedVersion);
  const versionUpgradeMessage = formatClaudeVersionUpgradeMessage(modelCatalog, parsedVersion);

  const capabilitiesResult = resolveCapabilities
    ? yield* resolveCapabilities(claudeSettings).pipe(Effect.result)
    : Result.succeed(undefined);
  const capabilities = Result.isSuccess(capabilitiesResult)
    ? capabilitiesResult.success
    : undefined;
  const models = capClaudeCatalogEffort(
    modelCatalog,
    claudeProviderModels(
      [
        ...resolveClaudeModelsForVersion(modelCatalog, parsedVersion),
        ...claudeReportedModels(modelCatalog, claudeSettings.customModels, capabilities?.models),
      ],
      claudeSettings.customModels,
    ),
    capabilities?.effortCapSources ?? [],
  );
  const skills = yield* discoverClaudeSkills(claudeSettings, cwd, resolvedEnvironment);
  const slashCommands = [COMPACT_SLASH_COMMAND, ...(capabilities?.slashCommands ?? [])];
  const dedupedSlashCommands = dedupeSlashCommands(slashCommands);

  if (!capabilities) {
    let message = "Could not verify Claude authentication status from initialization result.";
    if (Result.isFailure(capabilitiesResult)) {
      message = Cause.isTimeoutError(capabilitiesResult.failure)
        ? "Claude status check timed out. Try again when the environment is less busy."
        : "Claude status check failed. Try refreshing provider status.";
    }
    return buildServerProvider({
      presentation: CLAUDE_PRESENTATION,
      enabled: claudeSettings.enabled,
      checkedAt,
      models,
      updateRequiredModels,
      slashCommands: dedupedSlashCommands,
      skills,
      probe: {
        installed: true,
        version: parsedVersion,
        status: "warning",
        auth: { status: "unknown" },
        message,
      },
    });
  }

  const baseUrl =
    (yield* readClaudeSettingsEnv(claudeSettings, cwd, resolvedEnvironment)).ANTHROPIC_BASE_URL ??
    resolvedEnvironment.ANTHROPIC_BASE_URL;
  const customApiEndpoint = customClaudeApiEndpointHost(baseUrl) !== undefined;
  if (!customApiEndpoint && claudeAuthStatus(capabilities) === "unauthenticated") {
    const path = yield* Path.Path;
    const configDir = (yield* makeClaudeEnvironment(claudeSettings, resolvedEnvironment))
      .CLAUDE_CONFIG_DIR;
    return buildServerProvider({
      presentation: CLAUDE_PRESENTATION,
      enabled: claudeSettings.enabled,
      checkedAt,
      models,
      updateRequiredModels,
      slashCommands: dedupedSlashCommands,
      skills,
      probe: {
        installed: true,
        version: parsedVersion,
        status: "error",
        auth: { status: "unauthenticated" },
        message:
          configDir === undefined
            ? "Claude Code is not authenticated. Run `claude auth login` and try again."
            : claudeSignedOutMessage({ configDir, cwd: path.resolve(cwd ?? ".") }),
        transcription: { status: "unavailable", reason: "signedOut" },
      },
    });
  }

  const authMetadata =
    apiProviderAuthMetadata(capabilities.apiProvider) ??
    (customApiEndpoint ? { type: "customEndpoint", label: "Custom API endpoint" } : undefined) ??
    claudeAuthMetadata({
      subscriptionType: capabilities.subscriptionType,
      authMethod: capabilities.tokenSource,
      apiKeySource: capabilities.apiKeySource,
    });
  const usageCheckedAt = capabilities.usageCheckedAt ?? checkedAt;
  const usageLimits = !capabilities.usage
    ? makeUnavailableUsageLimits({ checkedAt, reason: "probeFailed" })
    : scopedLimitNames
      ? yield* recordClaudeUsageResponse(scopedLimitNames, {
          response: capabilities.usage,
          checkedAt: usageCheckedAt,
        })
      : claudeUsageResponseToLimits({
          response: capabilities.usage,
          checkedAt: usageCheckedAt,
        }).limits;
  const resetCredits =
    resolveResetCredits &&
    capabilities.subscriptionType &&
    !usageLimits.unavailable &&
    parsedVersion
      ? yield* resolveResetCredits(parsedVersion)
      : undefined;
  return buildServerProvider({
    presentation: CLAUDE_PRESENTATION,
    enabled: claudeSettings.enabled,
    checkedAt,
    models,
    updateRequiredModels,
    slashCommands: dedupedSlashCommands,
    skills,
    probe: {
      installed: true,
      version: parsedVersion,
      status: "ready",
      auth: {
        status: "authenticated",
        ...(capabilities.email ? { email: capabilities.email } : {}),
        ...(capabilities.workspaceId ? { workspaceId: capabilities.workspaceId } : {}),
        ...(authMetadata ? authMetadata : {}),
      },
      ...(versionUpgradeMessage ? { message: versionUpgradeMessage } : {}),
      usageLimits: resetCredits ? { ...usageLimits, resetCredits } : usageLimits,
      transcription: claudeTranscriptionStatus(capabilities, customApiEndpoint),
    },
  });
});

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

export const makePendingClaudeProvider: (
  claudeSettings: ClaudeSettings,
  modelCatalog?: ClaudeModelCatalog,
) => Effect.Effect<ServerProviderDraft> = Effect.fn("ClaudeProvider.makePendingClaudeProvider")(
  function* (
    claudeSettings: ClaudeSettings,
    modelCatalog: ClaudeModelCatalog = BUNDLED_CLAUDE_MODEL_CATALOG,
  ) {
    const checkedAt = yield* nowIso;
    const models = claudeProviderModels(
      modelCatalog.models.map((entry) => entry.model),
      claudeSettings.customModels,
    );

    if (!claudeSettings.enabled) {
      return buildServerProvider({
        presentation: CLAUDE_PRESENTATION,
        enabled: false,
        checkedAt,
        models,
        probe: {
          installed: false,
          version: null,
          status: "warning",
          auth: { status: "unknown" },
          message: "Claude is disabled in Supaterm settings.",
        },
      });
    }

    return buildServerProvider({
      presentation: CLAUDE_PRESENTATION,
      enabled: true,
      checkedAt,
      models,
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Claude provider status has not been checked in this session yet.",
      },
    });
  },
);

export { probeClaudeCapabilities };
