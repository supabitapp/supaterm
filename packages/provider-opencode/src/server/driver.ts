import { ProviderDriverKind, ProviderSetupError, TextGenerationError } from "@supaterm/contracts";
import { OpenCodeSettings } from "../settings.ts";
import * as Digest from "effect/crypto/Digest";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
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
import * as OpenCode2AdapterV2 from "./v2/adapter.ts";
import * as ProviderAdapter from "@supaterm/provider-core/server/ProviderAdapter";
import type { ProviderTextGeneration } from "@supaterm/provider-core/server/textGeneration";
import type * as TextGenerationOperations from "@supaterm/provider-core/server/textGenerationOperations";
import { ProviderDriverError } from "@supaterm/provider-core/server/errors";
import { openCodeUsageReader, type OpenCodeUsageReaderEnv } from "./usage.ts";
import { readOpenCodeGoUsageLimits } from "./usageLimits.ts";
import { loadOpenCode2Catalog } from "./openCode2Catalog.ts";
import {
  checkOpenCodeProviderStatus,
  loadOpenCode2Workspace,
  makeOpenCode2ModelLoader,
  makePendingOpenCodeProvider,
  openCode2CommandsToServerProviderSlashCommands,
  openCode2SkillsToServerProviderSkills,
} from "./status.ts";
import { makeManagedServerProvider } from "@supaterm/provider-core/server/managedProvider";
import * as OpenCodeRuntime from "./OpenCodeRuntime.ts";
import {
  isOpenCode1,
  makeOpenCodeRuntimeProbe,
  OPENCODE_1_UNSUPPORTED_MESSAGE,
  probeOpenCodeRuntime,
} from "./versionProbe.ts";
import * as OpenCode2Client from "./v2/OpenCode2Client.ts";
import * as OpenCode2Server from "./v2/OpenCode2Server.ts";
import {
  defaultProviderContinuationIdentity,
  type ProviderDriver,
  type ProviderInstance,
} from "@supaterm/provider-core/server/driver";
import { withInstanceIdentity } from "@supaterm/provider-core/server/instanceIdentity";
import { mergeProviderInstanceEnvironment } from "@supaterm/provider-core/server/instanceEnvironment";
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

function isOpenCodeNativeCommandPath(commandPath: string): boolean {
  const normalized = normalizeCommandPath(commandPath);
  return (
    normalized.endsWith("/.opencode/bin/opencode") ||
    normalized.endsWith("/.opencode/bin/opencode.exe")
  );
}

export const openCode2Update = makePackageManagedProviderMaintenanceResolver({
  provider: DRIVER_KIND,
  npmPackageName: "@opencode/cli",
  nativeUpdate: {
    args: ["upgrade"],
    isCommandPath: isOpenCodeNativeCommandPath,
    requiresCommandPath: true,
  },
  mise: { tool: "opencode" },
});

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
      probeOpenCodeRuntime(effectiveConfig, processEnv).pipe(
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
      maintenanceFor(runtimeProbe.get),
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
    );
    const listOpenCode2Workspace = (cwd: string) =>
      openCode2Server.withConnection(({ client, events }) =>
        Effect.gen(function* () {
          const location = { directory: cwd };
          const scanned = yield* Deferred.make<void>();
          const pending = new Set(["command.updated", "skill.updated"]);
          const stream = yield* events.pipe(Effect.option);
          if (stream._tag === "Some") {
            yield* stream.value.pipe(
              Stream.runForEach((event) =>
                "location" in event &&
                event.location?.directory === cwd &&
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

    const checkUsageLimits = readOpenCodeGoUsageLimits({
      enabled: effectiveConfig.enabled,
      serverUrl: effectiveConfig.serverUrl,
      environment: processEnv,
    }).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, pathService),
      Effect.provideService(HttpClient.HttpClient, httpClient),
      Effect.provideService(Digest.Digest, digest),
    );
    const checkProvider = Effect.all(
      {
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
      Effect.map(({ provider, usageLimits }) => ({ ...provider, usageLimits })),
      Effect.map(stampIdentity),
    );
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
                : Effect.all([
                    snapshot.getSnapshot,
                    listOpenCode2Workspace(cwd).pipe(
                      Effect.timeout("20 seconds"),
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
                  ]).pipe(
                    Effect.map(([machineSnapshot, { skills, commands }]) => ({
                      ...machineSnapshot,
                      skills: openCode2SkillsToServerProviderSkills(skills),
                      slashCommands: openCode2CommandsToServerProviderSlashCommands(commands),
                      // A finished scan lists at least the built-ins. None means it
                      // timed out, so the registry decides from the provider's health.
                      slashCommandsPending: commands.length > 0 ? false : undefined,
                    })),
                  ),
            ),
      orchestrationAdapter,
      textGeneration,
    } satisfies ProviderInstance;
  }),
};
