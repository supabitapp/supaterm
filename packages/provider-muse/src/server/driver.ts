import { ProviderDriverKind } from "@supaterm/contracts";
import { MuseSettings } from "../settings.ts";
import * as HostProcess from "@supaterm/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import * as ProviderLatestVersions from "@supaterm/provider-core/server/ProviderLatestVersions";
import * as ProviderHost from "@supaterm/provider-core/server/ProviderHost";
import * as McpProviderSessions from "@supaterm/provider-core/server/McpProviderSessions";
import { expandHomePath } from "@supaterm/provider-core/server/pathExpansion";
import { makeMuseTextGeneration } from "./textGeneration.ts";
import { ProviderDriverError } from "@supaterm/provider-core/server/errors";
import { makeMuseAdapterV2 } from "./adapter.ts";
import * as IdAllocator from "@supaterm/provider-core/server/IdAllocator";
import * as ProviderContinuationRequests from "@supaterm/provider-core/server/ProviderContinuationRequests";
import { checkMuseProviderStatus, makePendingMuseProvider } from "./status.ts";
import * as ProviderEventLoggers from "@supaterm/provider-core/server/ProviderEventLoggers";
import { makeManagedServerProvider } from "@supaterm/provider-core/server/managedProvider";
import { enrichMuseSnapshot, latestMuseVersion, museMaintenance } from "./maintenance.ts";
import { makeMuseEnvironment } from "./sdk.ts";
import { museUsageReader } from "./usage.ts";
import type * as MuseUsageHome from "./MuseUsageHome.ts";
import {
  defaultProviderContinuationIdentity,
  type ProviderDriver,
  type ProviderInstance,
} from "@supaterm/provider-core/server/driver";
import { mergeProviderInstanceEnvironment } from "@supaterm/provider-core/server/instanceEnvironment";
import {
  makeCachedProviderMaintenanceResolution,
  resolveProviderMaintenanceCapabilitiesEffect,
} from "@supaterm/provider-core/server/maintenanceResolver";
import {
  haveProviderSnapshotSettingsChanged,
  makeProviderSnapshotSettingsSource,
  type ProviderSnapshotSettings,
} from "@supaterm/provider-core/server/snapshotSettings";
import { withInstanceIdentity } from "@supaterm/provider-core/server/instanceIdentity";

const DRIVER_KIND = ProviderDriverKind.make("muse");
const decodeMuseSettings = Schema.decodeSync(MuseSettings);

export type MuseDriverEnv =
  | IdAllocator.IdAllocatorV2
  | McpProviderSessions.McpProviderSessions
  | ProviderHost.ProviderHost
  | ChildProcessSpawner.ChildProcessSpawner
  | FileSystem.FileSystem
  | HttpClient.HttpClient
  | ProviderLatestVersions.ProviderLatestVersions
  | Path.Path
  | ProviderEventLoggers.ProviderEventLoggers;

export const MuseDriver: ProviderDriver<
  MuseSettings,
  MuseDriverEnv,
  Path.Path | MuseUsageHome.MuseUsageHome
> = {
  driverKind: DRIVER_KIND,
  metadata: { displayName: "Muse Code", supportsMultipleInstances: true },
  usage: museUsageReader,
  configSchema: MuseSettings,
  defaultConfig: () => decodeMuseSettings({}),
  create: Effect.fn("MuseDriver.create")(function* ({
    instanceId,
    displayName,
    accentColor,
    environment,
    enabled,
    config,
  }) {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const httpClient = yield* HttpClient.HttpClient;
    const latestVersions = yield* ProviderLatestVersions.ProviderLatestVersions;
    const host = yield* ProviderHost.ProviderHost;
    const eventLoggers = yield* ProviderEventLoggers.ProviderEventLoggers;
    const { cwd } = host.paths;
    const continuationRequests = yield* ProviderContinuationRequests.ProviderContinuationRequests;
    const hostEnvironment = yield* HostProcess.Environment;

    const processEnvironment = yield* mergeProviderInstanceEnvironment(
      environment,
      makeMuseEnvironment(hostEnvironment),
    );
    const effectiveConfig = {
      ...config,
      enabled,
      binaryPath: expandHomePath(config.binaryPath, yield* HostProcess.HomeDirectory),
    } satisfies MuseSettings;
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
    const snapshotSettings = yield* makeProviderSnapshotSettingsSource(effectiveConfig);
    const resolveInstallation = yield* makeCachedProviderMaintenanceResolution(
      resolveProviderMaintenanceCapabilitiesEffect(museMaintenance, {
        binaryPath: effectiveConfig.binaryPath,
        env: processEnvironment,
      }).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.provideService(Path.Path, path),
      ),
    );
    const resolveMaintenance = Effect.fn("MuseDriver.resolveMaintenance")(function* (options?: {
      readonly fresh?: boolean;
    }) {
      const capabilities = yield* resolveInstallation(options);

      const latestVersion = options?.fresh
        ? yield* latestMuseVersion(processEnvironment, { fresh: true }).pipe(
            Effect.provideService(HttpClient.HttpClient, httpClient),
            Effect.provideService(ProviderLatestVersions.ProviderLatestVersions, latestVersions),
          )
        : undefined;
      return latestVersion !== undefined ? { ...capabilities, latestVersion } : capabilities;
    });
    const snapshot = yield* makeManagedServerProvider<ProviderSnapshotSettings<MuseSettings>>({
      // Status refresh respects update checks; explicit updates use the resolver below.
      resolveMaintenance: (options) =>
        host.settings.get.pipe(
          Effect.orDie,
          Effect.flatMap((settings) =>
            settings.enableProviderUpdateChecks
              ? resolveMaintenance(options)
              : resolveInstallation(options),
          ),
        ),
      getSettings: snapshotSettings.getSettings,
      streamSettings: snapshotSettings.streamSettings,
      haveSettingsChanged: haveProviderSnapshotSettingsChanged,
      initialSnapshot: (settings) =>
        makePendingMuseProvider(settings.provider).pipe(Effect.map(stampIdentity)),
      checkProvider: checkMuseProviderStatus(effectiveConfig, processEnvironment, cwd).pipe(
        Effect.map(stampIdentity),
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.provideService(Path.Path, path),
      ),
      enrichSnapshot: ({ settings, snapshot: currentSnapshot, publishSnapshot }) =>
        resolveMaintenance().pipe(
          Effect.flatMap((maintenanceCapabilities) =>
            enrichMuseSnapshot({
              snapshot: currentSnapshot,
              maintenanceCapabilities,
              enableProviderUpdateChecks: settings.enableProviderUpdateChecks,
              environment: processEnvironment,
            }),
          ),
          Effect.provideService(HttpClient.HttpClient, httpClient),
          Effect.provideService(ProviderLatestVersions.ProviderLatestVersions, latestVersions),
          Effect.flatMap(publishSnapshot),
        ),
    }).pipe(
      Effect.mapError(
        (cause) =>
          new ProviderDriverError({
            driver: DRIVER_KIND,
            instanceId,
            detail: "Failed to build Muse Code snapshot.",
            cause,
          }),
      ),
    );
    const modelCatalog = snapshot.getSnapshot.pipe(Effect.map((current) => current.models));
    const orchestrationAdapter = yield* makeMuseAdapterV2({
      instanceId,
      settings: effectiveConfig,
      environment: processEnvironment,
      modelCatalog,
      ...(eventLoggers.native ? { nativeEventLogger: eventLoggers.native } : {}),
      continuationRequests,
    });
    const textGeneration = yield* makeMuseTextGeneration(effectiveConfig, {
      environment: processEnvironment,
      modelCatalog,
    });
    return {
      instanceId,
      driverKind: DRIVER_KIND,
      continuationIdentity,
      displayName,
      accentColor,
      enabled,
      snapshot: { ...snapshot, resolveMaintenance },
      orchestrationAdapter,
      textGeneration,
    } satisfies ProviderInstance;
  }),
};
