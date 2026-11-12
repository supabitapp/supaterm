import { resolveProviderProbeTimeoutMs } from "@supaterm/provider-core/server/snapshotProbe";
import {
  ProviderDriverKind,
  ProviderSetupError,
  TextGenerationError,
  type ServerProviderModel,
} from "@supaterm/contracts";
import { OpenCodeSettings } from "../settings.ts";
import * as Digest from "effect/crypto/Digest";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
import * as Equal from "effect/Equal";
import * as Option from "effect/Option";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as HttpClient from "effect/http/HttpClient";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import * as OpenCode2TextGeneration from "./v2/textGeneration.ts";
import * as ProviderLatestVersions from "@supaterm/provider-core/server/ProviderLatestVersions";
import * as ProviderHost from "@supaterm/provider-core/server/ProviderHost";
import type * as IdAllocator from "@supaterm/provider-core/server/IdAllocator";
import type * as McpProviderSessions from "@supaterm/provider-core/server/McpProviderSessions";
import { expandHomePath } from "@supaterm/provider-core/server/pathExpansion";
import { AgentScope } from "@supaterm/shared/AgentScope";
import { compareSemverVersions } from "@supaterm/shared/semver";
import * as OpenCode2AdapterV2 from "./v2/adapter.ts";
import * as ProviderAdapter from "@supaterm/provider-core/server/ProviderAdapter";
import type { ProviderTextGeneration } from "@supaterm/provider-core/server/textGeneration";
import type * as TextGenerationOperations from "@supaterm/provider-core/server/textGenerationOperations";
import { ProviderDriverError } from "@supaterm/provider-core/server/errors";
import { openCodeUsageReader, type OpenCodeUsageReaderEnv } from "./usage.ts";
import { readOpenCodeGoUsageLimits } from "./usageLimits.ts";
import { loadOpenCode2Catalog, loadOpenCode2DirectoryCatalog } from "./openCode2Catalog.ts";
import {
  checkOpenCodeProviderStatus,
  loadOpenCode2Workspace,
  makeOpenCode2ModelLoader,
  makePendingOpenCodeProvider,
  openCode2CommandsToServerProviderSlashCommands,
  openCode2ProviderModels,
  openCode2SkillsToServerProviderSkills,
  readSettledOpenCode2Catalog,
} from "./status.ts";
import { makeManagedServerProvider } from "@supaterm/provider-core/server/managedProvider";
import * as OpenCodeRuntime from "./OpenCodeRuntime.ts";
import {
  isOpenCode1,
  makeOpenCodeRuntimeProbe,
  OPENCODE_1_UNSUPPORTED_MESSAGE,
  probeOpenCodeRuntime,
  probeOpenCodeBinary,
} from "./versionProbe.ts";
import * as OpenCode2Client from "./v2/OpenCode2Client.ts";
import * as OpenCode2Server from "./v2/OpenCode2Server.ts";
import { replaceOutdatedService } from "./v2/OpenCode2Service.ts";
import {
  defaultProviderContinuationIdentity,
  type ProviderDriver,
  type ProviderInstance,
} from "@supaterm/provider-core/server/driver";
import { withInstanceIdentity } from "@supaterm/provider-core/server/instanceIdentity";
import { mergeProviderInstanceEnvironment } from "@supaterm/provider-core/server/instanceEnvironment";
import { providerProbeEnvironment } from "@supaterm/provider-core/server/snapshotProbe";
import {
  enrichProviderSnapshotWithVersionAdvisory,
  makeCachedProviderMaintenanceResolution,
  makeManualOnlyProviderMaintenanceCapabilities,
  makePackageManagedProviderMaintenanceResolver,
  normalizeCommandPath,
  resolveProviderMaintenanceCapabilitiesEffect,
} from "@supaterm/provider-core/server/maintenanceResolver";
import {
  haveProviderSnapshotSettingsChanged,
  makeProviderSnapshotSettingsSource,
  type ProviderSnapshotSettings,
} from "@supaterm/provider-core/server/snapshotSettings";
import * as HostProcess from "@supaterm/shared/HostProcess";
const decodeOpenCodeSettings = Schema.decodeSync(OpenCodeSettings);

const DRIVER_KIND = ProviderDriverKind.make("opencode");

// A loopback server runs on this environment, but can outlive its CLI installation.
// Its reported version may therefore differ from the installed executable after an update.
export function isLocalOpenCodeServerUrl(serverUrl: string): boolean {
  const url = URL.parse(serverUrl.trim());
  if (url?.protocol !== "http:" && url?.protocol !== "https:") return false;
  return (
    url.hostname === "localhost" ||
    url.hostname === "[::1]" ||
    /^127\.(?:\d{1,3}\.){2}\d{1,3}$/.test(url.hostname)
  );
}

function isOpenCodeNativeCommandPath(commandPath: string): boolean {
  const normalized = normalizeCommandPath(commandPath);
  return (
    normalized.endsWith("/.opencode/bin/opencode") ||
    normalized.endsWith("/.opencode/bin/opencode.exe")
  );
}

function openCodeNativeHome(commandPath: string): string | null {
  const slashed = commandPath.replaceAll("\\", "/");
  const match = /\/\.opencode\/bin\/opencode(?:\.exe)?$/i.exec(slashed);
  if (!match) return null;
  return match.index === 0 ? "/" : slashed.slice(0, match.index);
}

export const openCode2Update = makePackageManagedProviderMaintenanceResolver({
  provider: DRIVER_KIND,
  npmPackageName: "@opencode/cli",
  nativeUpdate: {
    // `isOpenCodeNativeCommandPath` is the curl installer's own binary. Name the
    // method so OpenCode does not have to infer it from `process.execPath`, which
    // fails when the binary is launched through a wrapper or shim.
    args: ["upgrade", "--method", "curl"],
    isCommandPath: isOpenCodeNativeCommandPath,
    requiresCommandPath: true,
    // The curl installer writes to `$HOME/.opencode/bin`, so point HOME at the install it replaces.
    env: (context) => {
      const home =
        openCodeNativeHome(context.realCommandPath) ??
        openCodeNativeHome(context.resolvedCommandPath);
      return home ? { HOME: home } : {};
    },
  },
  mise: { tool: "opencode" },
});

// An unread catalog keeps what the registry found before rather than the machine catalog.
function workspaceModelsFor(
  machineModels: ReadonlyArray<ServerProviderModel>,
  cwdModels: Option.Option<ReadonlyArray<ServerProviderModel>>,
) {
  if (Option.isNone(cwdModels)) return { workspaceModelsPending: true };
  return Equal.equals(cwdModels.value, machineModels)
    ? {}
    : { models: cwdModels.value, workspaceModels: cwdModels.value };
}

export type OpenCodeDriverEnv =
  | IdAllocator.IdAllocatorV2
  | McpProviderSessions.McpProviderSessions
  | ProviderHost.ProviderHost
  | ChildProcessSpawner.ChildProcessSpawner
  | Digest.Digest
  | SecureRandom.SecureRandom
  | FileSystem.FileSystem
  | HttpClient.HttpClient
  | ProviderLatestVersions.ProviderLatestVersions
  | OpenCodeRuntime.OpenCodeRuntime
  | Path.Path;

export const OpenCodeDriver: ProviderDriver<
  OpenCodeSettings,
  OpenCodeDriverEnv,
  OpenCodeUsageReaderEnv
> = {
  driverKind: DRIVER_KIND,
  metadata: {
    displayName: "OpenCode",
    supportsMultipleInstances: true,
  },
  configSchema: OpenCodeSettings,
  defaultConfig: (): OpenCodeSettings => decodeOpenCodeSettings({}),
  usage: openCodeUsageReader,
  create: Effect.fn("OpencodeDriver.create")(function* ({
    instanceId,
    displayName,
    accentColor,
    environment,
    enabled,
    config,
  }) {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const openCodeRuntime = yield* OpenCodeRuntime.OpenCodeRuntime;
    const agentScope = yield* AgentScope;
    const httpClient = yield* HttpClient.HttpClient;
    const latestVersions = yield* ProviderLatestVersions.ProviderLatestVersions;
    const digest = yield* Digest.Digest;
    const host = yield* ProviderHost.ProviderHost;
    const processEnv = yield* mergeProviderInstanceEnvironment(environment);
    const homeDirectory = yield* HostProcess.HomeDirectory;
    const continuationIdentity = defaultProviderContinuationIdentity({
      driverKind: DRIVER_KIND,
      instanceId,
    });
    const stampIdentity = withInstanceIdentity({
      instanceId,
      driverKind: DRIVER_KIND,
      displayName,
      accentColor,
      continuationGroupKey: continuationIdentity.continuationKey,
    });
    const effectiveConfig = {
      ...config,
      enabled,
      binaryPath: expandHomePath(config.binaryPath, homeDirectory),
    } satisfies OpenCodeSettings;
    const runtimeProbe = yield* makeOpenCodeRuntimeProbe(
      probeOpenCodeRuntime(effectiveConfig, providerProbeEnvironment(processEnv)).pipe(
        Effect.provideService(HttpClient.HttpClient, httpClient),
        Effect.provideService(OpenCodeRuntime.OpenCodeRuntime, openCodeRuntime),
      ),
    );
    // Only a positively identified 1.x is refused; an unknown version reaches OpenCode 2's own errors.
    const detectsOpenCode1 = runtimeProbe.get.pipe(
      Effect.map(isOpenCode1),
      Effect.orElseSucceed(() => false),
    );
    const noUpdate = makeManualOnlyProviderMaintenanceCapabilities({
      provider: DRIVER_KIND,
      packageName: null,
    });
    // A 1.x install is never updated: 2.x converts the shared database in place, so the move is the user's.
    const maintenanceFor = (probed: typeof runtimeProbe.get) =>
      probed.pipe(
        Effect.option,
        Effect.flatMap((result) =>
          Option.isSome(result) && !isOpenCode1(result.value)
            ? resolveProviderMaintenanceCapabilitiesEffect(openCode2Update, {
                binaryPath: effectiveConfig.binaryPath,
                env: processEnv,
              })
            : Effect.succeed(noUpdate),
        ),
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.provideService(Path.Path, pathService),
      );
    const cachedMaintenance = yield* makeCachedProviderMaintenanceResolution(
      maintenanceFor(
        isLocalOpenCodeServerUrl(effectiveConfig.serverUrl)
          ? probeOpenCodeBinary(
              effectiveConfig.binaryPath,
              providerProbeEnvironment(processEnv),
            ).pipe(
              Effect.provideService(OpenCodeRuntime.OpenCodeRuntime, openCodeRuntime),
              Effect.catch(() => runtimeProbe.get),
            )
          : runtimeProbe.get,
      ),
    );
    const resolveMaintenance = (options?: { readonly fresh?: boolean }) =>
      !effectiveConfig.enabled
        ? Effect.succeed(noUpdate)
        : options?.fresh === true
          ? runtimeProbe.refresh.pipe(
              Effect.ignore,
              Effect.andThen(cachedMaintenance({ fresh: true })),
            )
          : cachedMaintenance();
    const openCode2Server = yield* OpenCode2Server.make({
      binaryPath: effectiveConfig.binaryPath,
      serverUrl: effectiveConfig.serverUrl,
      serverPassword: effectiveConfig.serverPassword,
      directory: host.paths.cwd,
      environment: processEnv,
    }).pipe(
      Effect.provideService(OpenCodeRuntime.OpenCodeRuntime, openCodeRuntime),
      Effect.provideService(
        OpenCode2Client.OpenCode2Client,
        yield* OpenCode2Client.make.pipe(Effect.provideService(HttpClient.HttpClient, httpClient)),
      ),
    );
    const openCode2Adapter = yield* OpenCode2AdapterV2.make(instanceId).pipe(
      Effect.provideService(OpenCode2Server.OpenCode2Server, openCode2Server),
    );
    const orchestrationAdapter: ProviderAdapter.ProviderAdapterV2["Service"] = {
      ...openCode2Adapter,
      getCapabilities: Effect.fn("OpenCodeDriver.getCapabilities")(function* () {
        const probed = Option.getOrUndefined(yield* runtimeProbe.lastSuccess);
        const capabilities = yield* openCode2Adapter.getCapabilities();
        return {
          ...capabilities,
          turns: {
            ...capabilities.turns,
            supportsNativeGoals:
              capabilities.turns.supportsNativeGoals ??
              (probed !== undefined &&
                !isOpenCode1(probed) &&
                compareSemverVersions(probed.version, "2.2.5") >= 0),
          },
        };
      }),
      openSession: (session) =>
        Effect.flatMap(detectsOpenCode1, (unsupported) =>
          unsupported
            ? Effect.fail(
                new ProviderAdapter.ProviderAdapterOpenSessionError({
                  driver: DRIVER_KIND,
                  providerSessionId: session.providerSessionId,
                  cause: new ProviderSetupError({
                    instanceId,
                    operation: "runtime",
                    detail: OPENCODE_1_UNSUPPORTED_MESSAGE,
                  }),
                }),
              )
            : openCode2Adapter.openSession(session),
        ),
    };
    const loadOpenCode2Models = yield* makeOpenCode2ModelLoader(
      openCode2Server.withConnection(({ client }) => loadOpenCode2Catalog(client, host.paths.cwd)),
      processEnv,
    );
    const listOpenCode2Workspace = (cwd: string) =>
      openCode2Server.withConnection(({ client, events }) =>
        Effect.gen(function* () {
          // OpenCode names a location by its resolved path (no trailing slash or `..`).
          const directory = pathService.resolve(cwd);
          const location = { directory };
          const scanned = yield* Deferred.make<void>();
          const pending = new Set(["command.updated", "skill.updated"]);
          const stream = yield* events.pipe(Effect.option);
          if (stream._tag === "Some") {
            yield* stream.value.pipe(
              Stream.runForEach((event) =>
                "location" in event &&
                event.location?.directory === directory &&
                pending.delete(event.type) &&
                pending.size === 0
                  ? Deferred.succeed(scanned, undefined)
                  : Effect.void,
              ),
              Effect.ignore,
              Effect.forkScoped,
            );
          }
          return yield* loadOpenCode2Workspace(
            Effect.all(
              {
                skills: client.skill.list({ location }).pipe(Effect.map((list) => list.data)),
                commands: client.command.list({ location }).pipe(Effect.map((list) => list.data)),
              },
              { concurrency: "unbounded" },
            ),
            Deferred.await(scanned),
            // Without events no scan can be awaited, so trust the first read as before.
            stream._tag === "None"
              ? Effect.succeed(true)
              : client.debug.location.list().pipe(
                  Effect.map((loaded) => loaded.some((entry) => entry.directory === directory)),
                  Effect.timeout("2 seconds"),
                  Effect.orElseSucceed(() => true),
                ),
            // OpenCode answers provider.list for a location only once its skill scan has ended.
            client.provider.list({ location }).pipe(Effect.timeout("10 seconds"), Effect.ignore),
            processEnv,
          );
        }).pipe(Effect.scoped),
      );
    const openCode2TextGeneration = yield* OpenCode2TextGeneration.make().pipe(
      Effect.provideService(OpenCode2Server.OpenCode2Server, openCode2Server),
    );
    const generateOnOpenCode2 = <A>(
      operation: TextGenerationOperations.Operation,
      generate: Effect.Effect<A, TextGenerationError>,
    ) =>
      Effect.flatMap(detectsOpenCode1, (unsupported) =>
        unsupported
          ? Effect.fail(
              new TextGenerationError({ operation, detail: OPENCODE_1_UNSUPPORTED_MESSAGE }),
            )
          : generate,
      );
    const textGeneration: ProviderTextGeneration = {
      generateCommitMessage: (input) =>
        generateOnOpenCode2(
          "generateCommitMessage",
          openCode2TextGeneration.generateCommitMessage(input),
        ),
      generatePrContent: (input) =>
        generateOnOpenCode2("generatePrContent", openCode2TextGeneration.generatePrContent(input)),
      generateBranchName: (input) =>
        generateOnOpenCode2(
          "generateBranchName",
          openCode2TextGeneration.generateBranchName(input),
        ),
      generateThreadTitle: (input) =>
        generateOnOpenCode2(
          "generateThreadTitle",
          openCode2TextGeneration.generateThreadTitle(input),
        ),
      generateReviewGuide: (input) =>
        generateOnOpenCode2(
          "generateReviewGuide",
          openCode2TextGeneration.generateReviewGuide(input),
        ),
    };

    const legacyUsageLimits = readOpenCodeGoUsageLimits({
      enabled: effectiveConfig.enabled,
      serverUrl: effectiveConfig.serverUrl,
      environment: processEnv,
    }).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, pathService),
      Effect.provideService(HttpClient.HttpClient, httpClient),
      Effect.provideService(Digest.Digest, digest),
    );
    let unsupportedUsageVersion: string | undefined;
    const checkUsageLimits = Effect.gen(function* () {
      if (!effectiveConfig.enabled) return yield* legacyUsageLimits;
      const runtime = yield* runtimeProbe.get;
      if (runtime.generation === "v1" || runtime.version === unsupportedUsageVersion)
        return yield* legacyUsageLimits;
      const limits = yield* openCode2Server.withConnection((connection) =>
        connection.usageLimits(host.paths.cwd),
      );
      if (limits === undefined) unsupportedUsageVersion = runtime.version;
      return limits ?? (yield* legacyUsageLimits);
    }).pipe(
      Effect.timeout("10 seconds"),
      Effect.catch(() =>
        Effect.map(DateTime.now, (now) => ({
          checkedAt: DateTime.formatIso(now),
          windows: [],
          unavailable: {
            reason: "probeFailed" as const,
            message: "OpenCode could not read workspace usage.",
          },
        })),
      ),
    );
    const checkProvider = Effect.all(
      {
        // A configured loopback server reports its running version. Probe the local
        // CLI separately so a completed npm update is not mistaken for a failure
        // while that independently managed server still runs the previous binary.
        installedVersion:
          effectiveConfig.enabled && isLocalOpenCodeServerUrl(effectiveConfig.serverUrl)
            ? probeOpenCodeBinary(
                effectiveConfig.binaryPath,
                providerProbeEnvironment(processEnv),
              ).pipe(
                Effect.map((probed) => probed.version),
                Effect.orElseSucceed(() => undefined),
                Effect.provideService(OpenCodeRuntime.OpenCodeRuntime, openCodeRuntime),
              )
            : Effect.void,
        provider: checkOpenCodeProviderStatus(
          effectiveConfig,
          runtimeProbe.refresh,
          loadOpenCode2Models,
        ).pipe(
          Effect.annotateLogs({ providerInstanceId: instanceId }),
          Effect.annotateSpans({ providerInstanceId: instanceId }),
        ),
        usageLimits: checkUsageLimits,
      },
      { concurrency: "unbounded" },
    ).pipe(
      Effect.map(({ provider, usageLimits, installedVersion }) => ({
        ...provider,
        usageLimits,
        ...(installedVersion === undefined ? {} : { installedVersion }),
      })),
      Effect.map(stampIdentity),
    );
    const serverUrl = effectiveConfig.serverUrl.trim();
    const afterUpdate =
      serverUrl.length > 0
        ? replaceOutdatedService({
            binaryPath: effectiveConfig.binaryPath,
            serverUrl,
            environment: processEnv,
          }).pipe(
            Effect.ensuring(openCode2Server.forget),
            Effect.mapError(
              (cause) =>
                new ProviderDriverError({
                  driver: DRIVER_KIND,
                  instanceId,
                  detail: "Failed to replace the OpenCode service after an update.",
                  cause,
                }),
            ),
            Effect.provideService(AgentScope, agentScope),
            Effect.provideService(OpenCodeRuntime.OpenCodeRuntime, openCodeRuntime),
            Effect.provideService(FileSystem.FileSystem, fileSystem),
            Effect.provideService(Path.Path, pathService),
          )
        : Effect.void;

    const snapshotSettings = yield* makeProviderSnapshotSettingsSource(effectiveConfig);
    const snapshot = yield* makeManagedServerProvider<ProviderSnapshotSettings<OpenCodeSettings>>({
      resolveMaintenance,
      getSettings: snapshotSettings.getSettings,
      streamSettings: snapshotSettings.streamSettings,
      haveSettingsChanged: haveProviderSnapshotSettingsChanged,
      checkProviderOnSettingsChange: () => false,
      // A failed or still-loading catalog must recover without a manual
      // refresh. Healthy instances need no recurring server starts.
      refreshOnInterval: (snapshot) =>
        snapshot.enabled &&
        snapshot.installed &&
        snapshot.status !== "ready" &&
        snapshot.auth.status === "unknown",
      initialSnapshot: (settings) =>
        makePendingOpenCodeProvider(settings.provider).pipe(Effect.map(stampIdentity)),
      checkProvider,
      checkUsageLimits,
      enrichSnapshot: ({ settings, snapshot, publishSnapshot }) =>
        resolveMaintenance().pipe(
          Effect.flatMap((maintenanceCapabilities) =>
            enrichProviderSnapshotWithVersionAdvisory(snapshot, maintenanceCapabilities, {
              enableProviderUpdateChecks: settings.enableProviderUpdateChecks,
            }),
          ),
          Effect.provideService(HttpClient.HttpClient, httpClient),
          Effect.provideService(ProviderLatestVersions.ProviderLatestVersions, latestVersions),
          Effect.flatMap((enrichedSnapshot) => publishSnapshot(enrichedSnapshot)),
        ),
    }).pipe(
      Effect.mapError(
        (cause) =>
          new ProviderDriverError({
            driver: DRIVER_KIND,
            instanceId,
            detail: `Failed to build OpenCode snapshot: ${cause.message ?? String(cause)}`,
            cause,
          }),
      ),
    );

    return {
      skillInstallDirectory: effectiveConfig.serverUrl
        ? undefined
        : pathService.join(
            processEnv.XDG_CONFIG_HOME?.trim() ||
              pathService.join(
                processEnv.HOME || processEnv.USERPROFILE || homeDirectory,
                ".config",
              ),
            "opencode",
            "skills",
          ),
      instanceId,
      driverKind: DRIVER_KIND,
      continuationIdentity,
      displayName,
      accentColor,
      enabled,
      snapshot,
      snapshotForCwd: (cwd) =>
        !effectiveConfig.enabled
          ? snapshot.getSnapshot
          : Effect.flatMap(detectsOpenCode1, (unsupported) =>
              unsupported
                ? snapshot.getSnapshot
                : Effect.all(
                    [
                      snapshot.getSnapshot,
                      // A project's opencode.jsonc can define its own providers.
                      readSettledOpenCode2Catalog(
                        openCode2Server.withConnection(({ client }) =>
                          loadOpenCode2DirectoryCatalog(client, cwd),
                        ),
                        processEnv,
                      ).pipe(
                        Effect.map(
                          Option.map((catalog) =>
                            openCode2ProviderModels(effectiveConfig, catalog),
                          ),
                        ),
                      ),
                      listOpenCode2Workspace(cwd).pipe(
                        // Leaves room for the reads around the scan wait, which uses the same override.
                        Effect.timeout(
                          2 * resolveProviderProbeTimeoutMs("opencode", 10_000, processEnv),
                        ),
                        Effect.mapError(
                          (cause) =>
                            new ProviderDriverError({
                              driver: DRIVER_KIND,
                              instanceId,
                              detail: `Failed to list OpenCode commands and skills for '${cwd}'`,
                              cause,
                            }),
                        ),
                      ),
                    ],
                    { concurrency: "unbounded" },
                  ).pipe(
                    Effect.map(([machineSnapshot, cwdModels, { skills, commands }]) => ({
                      ...machineSnapshot,
                      ...workspaceModelsFor(machineSnapshot.models, cwdModels),
                      skills: openCode2SkillsToServerProviderSkills(skills),
                      slashCommands: openCode2CommandsToServerProviderSlashCommands(commands),
                      // A finished scan lists at least the built-ins. None means it
                      // timed out, so the registry decides from the provider's health.
                      slashCommandsPending: commands.length > 0 ? false : undefined,
                    })),
                  ),
            ),
      invalidateCaches: openCode2Server.forget,
      afterUpdate,
      orchestrationAdapter,
      textGeneration,
    } satisfies ProviderInstance;
  }),
};
