import { resolveProviderProbeTimeoutMs } from "@supaterm/provider-core/server/snapshotProbe";
import {
  type ModelCapabilities,
  type ServerProviderModel,
  type ServerProviderSlashCommand,
} from "@supaterm/contracts";
import type { OpenCodeSettings } from "../settings.ts";
import * as Cause from "effect/Cause";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";

import { createModelCapabilities } from "@supaterm/shared/model";
import {
  buildServerProvider,
  COMPACT_SLASH_COMMAND,
  nonEmptyTrimmed,
  providerModelsFromSettings,
  type ServerProviderDraft,
} from "@supaterm/provider-core/server/snapshotProbe";
import * as OpenCodeRuntime from "./OpenCodeRuntime.ts";
import {
  isOpenCode1,
  OPENCODE_1_UNSUPPORTED_MESSAGE,
  type ProbedOpenCode,
} from "./versionProbe.ts";
import { ServiceUnavailableError } from "@opencode/protocol/errors";

const OPENCODE_PRESENTATION = {
  displayName: "OpenCode",
  showInteractionModeToggle: false,
} as const;

class OpenCodeProbeError extends Data.TaggedError("OpenCodeProbeError")<{
  readonly cause?: unknown;
  readonly detail: string;
}> {}

function normalizeProbeMessage(message: string) {
  const trimmed = message.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  if (
    trimmed === "An error occurred in Effect.tryPromise" ||
    trimmed === "An error occurred in Effect.try"
  ) {
    return undefined;
  }
  return trimmed;
}

function normalizedErrorMessage(cause: unknown) {
  if (cause instanceof OpenCodeProbeError) {
    return normalizeProbeMessage(cause.detail);
  }

  if (!(cause instanceof Error)) {
    return undefined;
  }

  return normalizeProbeMessage(cause.message);
}

function formatOpenCodeProbeError(input: {
  readonly cause: unknown;
  readonly isExternalServer: boolean;
  readonly serverUrl: string;
}) {
  const detail = normalizedErrorMessage(input.cause);
  const lower = detail?.toLowerCase() ?? "";

  if (input.isExternalServer) {
    if (
      /(?:^|\s)(?:status(?:\s+code)?(?:\s*[:=]\s*|\s+)|http(?:\/\d(?:\.\d)?)?\s+)(?:401|403)\b/.test(
        lower,
      ) ||
      /\b(?:unauthorized|forbidden)\b/.test(lower)
    ) {
      return {
        installed: true,
        authStatus: "unauthenticated",
        message: "OpenCode server rejected authentication. Check the server URL and password.",
      } satisfies {
        readonly installed: boolean;
        readonly message: string;
        readonly authStatus?: "unauthenticated";
      };
    }

    if (
      lower.includes("econnrefused") ||
      lower.includes("enotfound") ||
      lower.includes("fetch failed") ||
      lower.includes("networkerror") ||
      lower.includes("timed out") ||
      lower.includes("timeout") ||
      lower.includes("socket hang up")
    ) {
      return {
        installed: true,
        message: `Couldn't reach the configured OpenCode server at ${input.serverUrl}. Check that the server is running and the URL is correct.`,
      } satisfies {
        readonly installed: boolean;
        readonly message: string;
        readonly authStatus?: "unauthenticated";
      };
    }

    return {
      installed: true,
      message: detail ?? "Failed to connect to the configured OpenCode server.",
    } satisfies {
      readonly installed: boolean;
      readonly message: string;
      readonly authStatus?: "unauthenticated";
    };
  }

  if (lower.includes("enoent") || lower.includes("notfound")) {
    return {
      installed: false,
      message: "OpenCode CLI (`opencode`) is not installed or not on PATH.",
    } satisfies {
      readonly installed: boolean;
      readonly message: string;
      readonly authStatus?: "unauthenticated";
    };
  }

  if (lower.includes("quarantine")) {
    return {
      installed: true,
      message:
        "macOS is blocking the OpenCode binary (quarantine). Run `xattr -d com.apple.quarantine $(which opencode)` to fix this.",
    } satisfies {
      readonly installed: boolean;
      readonly message: string;
      readonly authStatus?: "unauthenticated";
    };
  }

  if (lower.includes("invalid code signature") || lower.includes("corrupted")) {
    return {
      installed: true,
      message:
        "macOS killed the OpenCode process due to an invalid code signature. The binary may be corrupted. Try reinstalling OpenCode.",
    } satisfies {
      readonly installed: boolean;
      readonly message: string;
      readonly authStatus?: "unauthenticated";
    };
  }

  const failureLabel = "Failed to execute OpenCode CLI health check";
  return {
    installed: true,
    message: detail ? `${failureLabel}: ${detail}` : `${failureLabel}.`,
  } satisfies {
    readonly installed: boolean;
    readonly message: string;
    readonly authStatus?: "unauthenticated";
  };
}

const logDiscoveryFailure = Effect.fnUntraced(function* (input: {
  readonly phase: "version" | "models";
  readonly isExternalServer: boolean;
  readonly version?: string;
  readonly cause?: Cause.Cause<unknown>;
}) {
  const outcome = input.cause ? "failed" : "empty";
  const attributes = {
    provider: "opencode",
    phase: input.phase,
    outcome,
    serverMode: input.isExternalServer ? "external" : "managed",
    ...(input.version === undefined ? {} : { version: input.version }),
  };
  yield* Effect.annotateCurrentSpan({
    "discovery.phase": input.phase,
    "discovery.outcome": outcome,
  });
  yield* (
    input.cause
      ? Effect.logWarning("OpenCode discovery failed", input.cause)
      : Effect.logWarning("OpenCode discovery failed")
  ).pipe(Effect.annotateLogs(attributes));
});

function titleCaseSlug(value: string) {
  const segments: Array<string> = [];
  for (const segment of value.split(/[-_/]+/)) {
    if (segment.length > 0) {
      segments.push(segment.charAt(0).toUpperCase() + segment.slice(1));
    }
  }
  return segments.join(" ");
}

function inferDefaultVariant(providerID: string, variants: ReadonlyArray<string>) {
  if (variants.length === 1) {
    return variants[0];
  }
  if (providerID === "anthropic" || providerID.startsWith("google")) {
    return variants.includes("high") ? "high" : undefined;
  }
  if (providerID === "openai" || providerID === "opencode" || providerID === "opencode-go") {
    return variants.includes("medium") ? "medium" : variants.includes("high") ? "high" : undefined;
  }
  return undefined;
}

const DEFAULT_OPENCODE_MODEL_CAPABILITIES: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [
    {
      id: "variant",
      label: "Reasoning",
      type: "select",
      options: [
        { id: "low", label: "Low" },
        { id: "medium", label: "Medium", isDefault: true },
        { id: "high", label: "High" },
        { id: "xhigh", label: "Extra High" },
      ],
      currentValue: "medium",
    },
  ],
});

interface OpenCodeRelease {
  readonly providerID: string;
  readonly family?: string | undefined;
  readonly released?: number | undefined;
  readonly deprecated?: boolean | undefined;
}

function markOpenCodeLegacy(
  entries: ReadonlyArray<{
    readonly model: ServerProviderModel;
    readonly release: OpenCodeRelease;
  }>,
) {
  const familyKey = ({ providerID, family }: OpenCodeRelease) =>
    family ? `${providerID}/${family}` : undefined;
  const newest = new Map<string, number>();
  for (const { release } of entries) {
    const key = familyKey(release);
    if (key === undefined || release.released === undefined || release.deprecated) continue;
    newest.set(key, Math.max(newest.get(key) ?? release.released, release.released));
  }
  return entries.map(({ model, release }) => {
    const key = familyKey(release);
    const latest = key === undefined ? undefined : newest.get(key);
    const superseded =
      latest !== undefined && release.released !== undefined && release.released < latest;
    return release.deprecated || superseded ? { ...model, isLegacy: true } : model;
  });
}

function trimOptional(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

export const makePendingOpenCodeProvider: (
  openCodeSettings: OpenCodeSettings,
) => Effect.Effect<ServerProviderDraft> = Effect.fn(
  "OpencodeProviderStatus.makePendingOpenCodeProvider",
)(function* (openCodeSettings: OpenCodeSettings) {
  const checkedAt = yield* Effect.map(DateTime.now, DateTime.formatIso);
  const models = providerModelsFromSettings(
    [],
    openCodeSettings.customModels,
    DEFAULT_OPENCODE_MODEL_CAPABILITIES,
  );

  if (!openCodeSettings.enabled) {
    return buildServerProvider({
      presentation: OPENCODE_PRESENTATION,
      enabled: false,
      checkedAt,
      models,
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message:
          openCodeSettings.serverUrl.trim().length > 0
            ? "OpenCode is disabled in Supaterm settings. A server URL is configured."
            : "OpenCode is disabled in Supaterm settings.",
      },
    });
  }

  return buildServerProvider({
    presentation: OPENCODE_PRESENTATION,
    enabled: true,
    checkedAt,
    models,
    probe: {
      installed: false,
      version: null,
      status: "warning",
      auth: { status: "unknown" },
      message: "OpenCode provider status has not been checked in this session yet.",
    },
  });
});

export interface OpenCode2Model extends OpenCodeRelease {
  readonly id: string;
  readonly name: string;
  readonly providerName?: string;
  readonly variants: ReadonlyArray<{ readonly id: string }>;
}

function subProviderLabelFor(input: {
  readonly providerID: string;
  readonly providerName?: string;
}) {
  const label = nonEmptyTrimmed(input.providerName) ?? input.providerID;
  return label.toLowerCase() === OPENCODE_PRESENTATION.displayName.toLowerCase()
    ? undefined
    : label;
}

const catalogFingerprint = (models: ReadonlyArray<OpenCode2Model>) =>
  models
    .map((model) =>
      JSON.stringify([
        model.providerID,
        model.id,
        model.name,
        model.providerName,
        model.variants.map((variant) => variant.id).toSorted(),
      ]),
    )
    .toSorted()
    .join("\n");

const PLUGIN_ACTIVATION_DEADLINE = "2 minutes";

const isServiceUnavailable = Schema.is(ServiceUnavailableError);
const isActivatingPlugins: (error: unknown) => boolean = (error: unknown) =>
  OpenCodeRuntime.isOpenCodeRuntimeError(error)
    ? isActivatingPlugins(error.cause)
    : isServiceUnavailable(error) && error.service === "plugin";

const settleOpenCode2Catalog = <E>(
  list: Effect.Effect<ReadonlyArray<OpenCode2Model>, E>,
  first?: ReadonlyArray<OpenCode2Model>,
) =>
  Effect.suspend(() => {
    let previous = first && first.length > 0 ? catalogFingerprint(first) : undefined;
    return (first ? Effect.delay(list, "250 millis") : list).pipe(
      Effect.repeat({
        until: (models) => {
          const fingerprint = models.length > 0 ? catalogFingerprint(models) : undefined;
          const settled = fingerprint !== undefined && fingerprint === previous;
          previous = fingerprint;
          return settled;
        },
        schedule: Schedule.spaced("250 millis"),
      }),
    );
  });

const OPENCODE_2_CATALOG_SETTLE_TIMEOUT_MS = 5_000;

export const makeOpenCode2ModelLoader = <E>(
  list: Effect.Effect<ReadonlyArray<OpenCode2Model>, E>,
  environment?: NodeJS.ProcessEnv,
) =>
  Effect.sync(() => {
    let lastLoaded: ReadonlyArray<OpenCode2Model> = [];
    return Effect.suspend(() => {
      let latest: ReadonlyArray<OpenCode2Model> = [];
      const tracked = list.pipe(
        Effect.tap((models) =>
          Effect.sync(() => {
            if (models.length > 0) latest = models;
          }),
        ),
      );
      return tracked.pipe(
        Effect.retry({ while: isActivatingPlugins, schedule: Schedule.spaced("1 second") }),
        Effect.timeoutOption(PLUGIN_ACTIVATION_DEADLINE),
        Effect.flatMap((first) =>
          Option.isNone(first)
            ? Effect.succeedNone
            : settleOpenCode2Catalog(tracked, first.value).pipe(
                Effect.timeoutOption(
                  resolveProviderProbeTimeoutMs(
                    "opencode",
                    OPENCODE_2_CATALOG_SETTLE_TIMEOUT_MS,
                    environment,
                  ),
                ),
              ),
        ),
        Effect.catch((error) =>
          latest.length > 0 ? Effect.succeedSome(latest) : Effect.fail(error),
        ),
        Effect.map((loaded) => {
          if (loaded._tag === "Some") lastLoaded = loaded.value;
          else if (latest.length > 0) lastLoaded = latest;
          return lastLoaded;
        }),
      );
    });
  });

/** None when the reads fail or never agree, so a partial catalog never passes for a settled one. */
export const readSettledOpenCode2Catalog = <E>(
  list: Effect.Effect<ReadonlyArray<OpenCode2Model>, E>,
  environment?: NodeJS.ProcessEnv,
) =>
  settleOpenCode2Catalog(list).pipe(
    Effect.timeoutOption(
      resolveProviderProbeTimeoutMs("opencode", OPENCODE_2_CATALOG_SETTLE_TIMEOUT_MS, environment),
    ),
    Effect.orElseSucceed(() => Option.none<ReadonlyArray<OpenCode2Model>>()),
  );

export interface OpenCode2Workspace {
  readonly skills: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly path: string;
    readonly description?: string | undefined;
  }>;
  readonly commands: ReadonlyArray<{
    readonly name: string;
    readonly description?: string | undefined;
  }>;
}

/**
 * Reading a location the server has not loaded boots its scan, and only reads after the scan's
 * `command.updated` plus `skill.updated` are complete; `scanned` must listen before `read`. A
 * loaded location listing no commands is still scanning. A location another caller booted
 * moments earlier lists as loaded with only built-ins, so `settled` waits out its scan first.
 */
export const loadOpenCode2Workspace = Effect.fn("OpencodeProviderStatus.loadOpenCode2Workspace")(
  function* <E>(
    read: Effect.Effect<OpenCode2Workspace, E>,
    scanned: Effect.Effect<void>,
    loaded: Effect.Effect<boolean>,
    settled: Effect.Effect<void> = Effect.void,
    environment?: NodeJS.ProcessEnv,
  ) {
    const wasLoaded = yield* loaded;
    yield* settled;
    const first = yield* read;
    if (wasLoaded && first.commands.length > 0) return first;
    yield* scanned.pipe(
      Effect.timeoutOption(resolveProviderProbeTimeoutMs("opencode", 10_000, environment)),
    );
    return yield* read;
  },
);

export function openCode2SkillsToServerProviderSkills(skills: OpenCode2Workspace["skills"]) {
  return skills
    .map((skill) => {
      const description = trimOptional(skill.description);
      return {
        name: skill.id,
        path: skill.path,
        enabled: true,
        ...(skill.name === skill.id ? {} : { displayName: skill.name }),
        ...(description ? { description, shortDescription: description } : {}),
      };
    })
    .toSorted((left, right) => left.name.localeCompare(right.name));
}

export function openCode2CommandsToServerProviderSlashCommands(
  commands: OpenCode2Workspace["commands"],
) {
  const slashCommands: ServerProviderSlashCommand[] = [COMPACT_SLASH_COMMAND];
  const names = new Set([COMPACT_SLASH_COMMAND.name]);
  for (const command of commands) {
    const name = trimOptional(command.name);
    if (!name || names.has(name)) continue;
    names.add(name);
    const description = trimOptional(command.description);
    slashCommands.push({ name, ...(description ? { description } : {}) });
  }
  return slashCommands;
}

const OPENCODE_2_PRESENTATION = {
  ...OPENCODE_PRESENTATION,
  showInteractionModeToggle: true,
  supportedRuntimeModes: ["approval-required", "auto-accept-edits", "auto", "full-access"],
} as const;

function openCode2ModelCapabilities(model: OpenCode2Model) {
  const variants = model.variants.map((variant) => variant.id);
  const defaultVariant = inferDefaultVariant(model.providerID, variants);
  return createModelCapabilities({
    optionDescriptors:
      variants.length === 0
        ? []
        : [
            {
              id: "variant",
              label: "Reasoning",
              type: "select",
              options: variants.map((id) => ({
                id,
                label: titleCaseSlug(id),
                ...(id === defaultVariant ? { isDefault: true } : {}),
              })),
              ...(defaultVariant === undefined ? {} : { currentValue: defaultVariant }),
            },
          ],
  });
}

export function openCode2ProviderModels(
  settings: Pick<OpenCodeSettings, "customModels">,
  catalog: ReadonlyArray<OpenCode2Model>,
) {
  return providerModelsFromSettings(
    markOpenCodeLegacy(
      catalog.map((model) => {
        const subProvider = subProviderLabelFor(model);
        return {
          model: {
            slug: `${model.providerID}/${model.id}`,
            name: model.name,
            ...(subProvider ? { subProvider } : {}),
            isCustom: false,
            capabilities: openCode2ModelCapabilities(model),
          },
          release: model,
        };
      }),
    ).toSorted((left, right) => left.name.localeCompare(right.name)),
    settings.customModels,
    DEFAULT_OPENCODE_MODEL_CAPABILITIES,
  );
}

const checkOpenCode2 = Effect.fn("checkOpenCode2")(function* (
  settings: OpenCodeSettings,
  version: string,
  checkedAt: string,
  loadModels: Effect.Effect<ReadonlyArray<OpenCode2Model>, OpenCodeRuntime.OpenCodeRuntimeError>,
) {
  const result = yield* Effect.exit(loadModels);
  const probe = (status: "ready" | "warning" | "error", message: string) => ({
    installed: true,
    version,
    status,
    auth: { status: status === "ready" ? ("authenticated" as const) : ("unknown" as const) },
    message,
  });
  if (result._tag === "Failure") {
    yield* logDiscoveryFailure({
      phase: "models",
      isExternalServer: settings.serverUrl.trim().length > 0,
      version,
      cause: result.cause,
    });
    return buildServerProvider({
      presentation: OPENCODE_2_PRESENTATION,
      enabled: true,
      checkedAt,
      models: providerModelsFromSettings(
        [],
        settings.customModels,
        DEFAULT_OPENCODE_MODEL_CAPABILITIES,
      ),
      slashCommands: [COMPACT_SLASH_COMMAND],
      probe: probe("error", "OpenCode could not load its model list."),
    });
  }
  if (result.value.length === 0) {
    yield* logDiscoveryFailure({
      phase: "models",
      isExternalServer: settings.serverUrl.trim().length > 0,
      version,
    });
  }
  return buildServerProvider({
    presentation: OPENCODE_2_PRESENTATION,
    enabled: true,
    checkedAt,
    models: openCode2ProviderModels(settings, result.value),
    slashCommands: [COMPACT_SLASH_COMMAND],
    probe:
      result.value.length > 0
        ? probe(
            "ready",
            `OpenCode ${version} lists ${result.value.length} model${result.value.length === 1 ? "" : "s"}.`,
          )
        : probe("warning", "OpenCode 2 is running, but it did not list any models yet."),
  });
});

export const checkOpenCodeProviderStatus: (
  openCodeSettings: OpenCodeSettings,
  probeRuntime: Effect.Effect<ProbedOpenCode, OpenCodeRuntime.OpenCodeRuntimeError>,
  loadOpenCode2Models: Effect.Effect<
    ReadonlyArray<OpenCode2Model>,
    OpenCodeRuntime.OpenCodeRuntimeError
  >,
) => Effect.Effect<ServerProviderDraft> = Effect.fn("checkOpenCodeProviderStatus")(function* (
  openCodeSettings: OpenCodeSettings,
  probeRuntime: Effect.Effect<ProbedOpenCode, OpenCodeRuntime.OpenCodeRuntimeError>,
  loadOpenCode2Models: Effect.Effect<
    ReadonlyArray<OpenCode2Model>,
    OpenCodeRuntime.OpenCodeRuntimeError
  >,
) {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  const customModels = openCodeSettings.customModels;
  const isExternalServer = openCodeSettings.serverUrl.trim().length > 0;

  if (!openCodeSettings.enabled) {
    return buildServerProvider({
      presentation: OPENCODE_PRESENTATION,
      enabled: false,
      checkedAt,
      models: providerModelsFromSettings([], customModels, DEFAULT_OPENCODE_MODEL_CAPABILITIES),
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: isExternalServer
          ? "OpenCode is disabled in Supaterm settings. A server URL is configured."
          : "OpenCode is disabled in Supaterm settings.",
      },
    });
  }

  const probedExit = yield* Effect.exit(
    probeRuntime.pipe(
      Effect.mapError(
        (cause) =>
          new OpenCodeProbeError({
            cause,
            detail: OpenCodeRuntime.openCodeRuntimeErrorDetail(cause),
          }),
      ),
    ),
  );
  if (probedExit._tag === "Failure") {
    yield* logDiscoveryFailure({ phase: "version", isExternalServer, cause: probedExit.cause });
    const failure = formatOpenCodeProbeError({
      cause: Cause.squash(probedExit.cause),
      isExternalServer,
      serverUrl: openCodeSettings.serverUrl,
    });
    return buildServerProvider({
      presentation: OPENCODE_PRESENTATION,
      enabled: true,
      checkedAt,
      models: providerModelsFromSettings([], customModels, DEFAULT_OPENCODE_MODEL_CAPABILITIES),
      probe: {
        installed: failure.installed,
        version: null,
        status: "error",
        auth: { status: failure.authStatus ?? "unknown" },
        message: failure.message,
      },
    });
  }
  const probed = probedExit.value;
  if (isOpenCode1(probed)) {
    return buildServerProvider({
      presentation: OPENCODE_PRESENTATION,
      enabled: true,
      checkedAt,
      models: providerModelsFromSettings([], customModels, DEFAULT_OPENCODE_MODEL_CAPABILITIES),
      probe: {
        installed: true,
        version: probed.version,
        status: "error",
        auth: { status: "unknown" },
        message: OPENCODE_1_UNSUPPORTED_MESSAGE,
      },
    });
  }
  return yield* checkOpenCode2(openCodeSettings, probed.version, checkedAt, loadOpenCode2Models);
});
