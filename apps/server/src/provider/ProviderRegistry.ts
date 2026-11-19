import {
  defaultInstanceIdForDriver,
  isProviderWorkspaceSnapshotCurrent,
  isProviderWorkspaceSnapshotPending,
  ProviderDriverKind,
  type ProviderInstanceId,
  type ServerProvider,
  type ServerProviderUpdateState,
} from "@supaterm/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as Semaphore from "effect/Semaphore";

import * as ProviderLatestVersions from "@supaterm/provider-core/server/ProviderLatestVersions";
import * as ModelManifest from "./ModelManifest.ts";
import { applyProviderCompatibility } from "./providerCompatibility.ts";
import * as ServerConfig from "../config.ts";
import { refreshWindowsPath } from "../os-jank.ts";
import * as ProviderInstanceRegistry from "./ProviderInstanceRegistry.ts";
import * as ProviderInstanceRegistryMutator from "./ProviderInstanceRegistryMutator.ts";
import {
  hydrateCachedProvider,
  isCachedProviderCorrelated,
  orderProviderSnapshots,
  readProviderStatusCache,
  resolveProviderStatusCachePath,
  writeProviderStatusCache,
} from "./providerStatusCache.ts";
import type {
  ProviderInstance,
  ProviderWorkspaceSnapshot,
} from "@supaterm/provider-core/server/driver";
import {
  makeManualOnlyProviderMaintenanceCapabilities,
  type ProviderMaintenanceCapabilities,
  latestProviderVersionCacheKeys,
} from "@supaterm/provider-core/server/maintenanceResolver";
import type { ProviderSnapshotSource } from "./builtInProviderCatalog.ts";

export type ProviderMaintenanceActionKind = "update";

export class ProviderRegistry extends Context.Service<
  ProviderRegistry,
  {
    readonly getProviders: Effect.Effect<ReadonlyArray<ServerProvider>>;

    readonly refresh: (
      provider?: ProviderDriverKind,
    ) => Effect.Effect<ReadonlyArray<ServerProvider>>;

    /**
     * When the instance id is unknown the call resolves with the currently
     * cached list (no error) — matching the legacy `refresh` shim behaviour so
     * transport layers don't have to special-case unknowns.
     */
    readonly refreshInstance: (
      instanceId: ProviderInstanceId,
    ) => Effect.Effect<ReadonlyArray<ServerProvider>>;

    /** Only refreshed instances can verify an update; the published list still includes every row. */
    readonly refreshAfterUpdate: (
      provider: ProviderDriverKind,
      selectedInstanceId: ProviderInstanceId,
    ) => Effect.Effect<ReadonlyArray<ServerProvider>>;

    readonly refreshWorkspaceSnapshot: (input: {
      readonly instanceId: ProviderInstanceId;
      readonly cwd: string;
      /** Directory the driver scans; the snapshot stays keyed by `cwd`. Defaults to `cwd`. */
      readonly scanCwd?: string;
      readonly fresh?: boolean;
    }) => Effect.Effect<ReadonlyArray<ServerProvider>>;

    /**
     * Drop Supaterm-owned model caches before an explicit model refresh. Pass the
     * target of the refresh that follows. Background and ordinary refreshes
     * keep their cache timers and must not call this.
     */
    readonly invalidateModelCaches: (input: {
      readonly instanceId?: ProviderInstanceId | undefined;
      readonly cwd?: string | undefined;
      readonly fresh?: boolean | undefined;
    }) => Effect.Effect<void>;

    /**
     * For an opened model picker: refetch a model manifest older than a few
     * minutes. When it changed, recheck latest CLI versions and probe providers.
     */
    readonly refreshModelCatalog: Effect.Effect<void>;

    readonly getProviderMaintenanceCapabilitiesForInstance: (
      instanceId: ProviderInstanceId,
      provider: ProviderDriverKind,
      options?: { readonly fresh?: boolean },
    ) => Effect.Effect<ProviderMaintenanceCapabilities>;

    readonly setProviderMaintenanceActionState: (input: {
      readonly instanceId: ProviderInstanceId;
      readonly action: ProviderMaintenanceActionKind;
      readonly state: ServerProviderUpdateState | null;
      readonly targetVersion?: string | undefined;
    }) => Effect.Effect<ReadonlyArray<ServerProvider>>;

    readonly streamChanges: Stream.Stream<ReadonlyArray<ServerProvider>>;
  }
>()("supaterm/provider/ProviderRegistry") {}

const loadProviders = (providerSources: ReadonlyArray<ProviderSnapshotSource>) =>
  Effect.forEach(
    providerSources,
    (providerSource) =>
      providerSource.getSnapshot.pipe(
        Effect.flatMap((snapshot) => correlateSnapshotWithSource(providerSource, snapshot)),
      ),
    {
      concurrency: "unbounded",
    },
  );

const makeManualProviderMaintenanceCapabilities = (provider: ProviderDriverKind) =>
  makeManualOnlyProviderMaintenanceCapabilities({
    provider,
    packageName: null,
  });

const hasModelCapabilities = (model: ServerProvider["models"][number]) =>
  (model.capabilities?.optionDescriptors?.length ?? 0) > 0;

const MAX_WORKSPACE_SNAPSHOTS_PER_PROVIDER = 16;

function dropProviderWorkspaceSnapshot(provider: ServerProvider, cwd: string) {
  return provider.workspaceSnapshots?.some((snapshot) => snapshot.cwd === cwd)
    ? {
        ...provider,
        workspaceSnapshots: provider.workspaceSnapshots.filter((snapshot) => snapshot.cwd !== cwd),
      }
    : provider;
}

export function upsertProviderWorkspaceSnapshot(
  provider: ServerProvider,
  cwd: string,
  scopedSnapshot: ProviderWorkspaceSnapshot,
) {
  const previousSnapshot = provider.workspaceSnapshots?.find((snapshot) => snapshot.cwd === cwd);
  const optionDescriptors = scopedSnapshot.optionDescriptors ?? previousSnapshot?.optionDescriptors;
  const models = scopedSnapshot.workspaceModelsPending
    ? previousSnapshot?.models
    : scopedSnapshot.workspaceModels;
  const workspaceSnapshot = {
    cwd,
    checkedAt: scopedSnapshot.checkedAt,
    slashCommands: scopedSnapshot.slashCommandsPending
      ? (previousSnapshot?.slashCommands ?? scopedSnapshot.slashCommands)
      : scopedSnapshot.slashCommands,
    ...(scopedSnapshot.slashCommandsPending ? { slashCommandsPending: true } : {}),
    skills: scopedSnapshot.skills,
    ...(optionDescriptors === undefined ? {} : { optionDescriptors }),
    ...(models === undefined ? {} : { models }),
    ...(scopedSnapshot.workspaceModelsPending ? { modelsPending: true } : {}),
  } satisfies NonNullable<ServerProvider["workspaceSnapshots"]>[number];
  return {
    ...provider,
    workspaceSnapshots: [
      ...(provider.workspaceSnapshots ?? []).filter((snapshot) => snapshot.cwd !== cwd),
      workspaceSnapshot,
    ].slice(-MAX_WORKSPACE_SNAPSHOTS_PER_PROVIDER),
  };
}

const shouldRetainMissingProviderModels = (provider: ServerProvider) => {
  if (provider.driver === ProviderDriverKind.make("pi")) {
    return !(
      provider.installed &&
      (provider.status === "ready" || provider.status === "warning") &&
      provider.auth.status !== "unknown"
    );
  }

  if (provider.driver === ProviderDriverKind.make("acpRegistry")) {
    return !(
      provider.installed &&
      provider.status === "ready" &&
      provider.nativeSessions !== undefined
    );
  }

  if (provider.driver === ProviderDriverKind.make("kiro")) {
    return true;
  }

  if (provider.driver === ProviderDriverKind.make("claudeAgent")) {
    return true;
  }

  const isAntigravity = provider.driver === ProviderDriverKind.make("antigravity");
  const isCodex = provider.driver === ProviderDriverKind.make("codex");
  const isOpenCode = provider.driver === ProviderDriverKind.make("opencode");
  if (!isAntigravity && !isCodex && !isOpenCode) {
    return !(provider.installed && provider.status === "ready");
  }

  if (
    (isAntigravity || isCodex) &&
    (!provider.enabled || provider.auth.status === "unauthenticated")
  ) {
    return false;
  }

  const isPendingAntigravityAuthentication =
    isAntigravity && provider.status === "warning" && provider.auth.status === "unknown";
  const isPendingInitialProbe =
    provider.enabled && !provider.installed && provider.status === "warning";
  const isIncompleteInstalledProbe =
    provider.installed &&
    (provider.status === "error" || ((isCodex || isOpenCode) && provider.status === "warning"));
  return isPendingAntigravityAuthentication || isPendingInitialProbe || isIncompleteInstalledProbe;
};

const shouldRetainMissingOpenCodeMetadata = (provider: ServerProvider) =>
  provider.driver === ProviderDriverKind.make("opencode") &&
  shouldRetainMissingProviderModels(provider);

const mergeProviderModels = (
  provider: ServerProvider,
  previousModels: ReadonlyArray<ServerProvider["models"][number]>,
  nextModels: ReadonlyArray<ServerProvider["models"][number]>,
) => {
  const shouldRetainMissingModels = shouldRetainMissingProviderModels(provider);

  const updateRequiredSlugs = new Set(provider.updateRequiredModels?.map((model) => model.slug));
  const retainablePreviousModels = previousModels.filter(
    (model) => !model.isCustom && !updateRequiredSlugs.has(model.slug),
  );

  if (shouldRetainMissingModels && nextModels.length === 0 && retainablePreviousModels.length > 0) {
    return retainablePreviousModels;
  }

  const previousBySlug = new Map(previousModels.map((model) => [model.slug, model] as const));
  const mergedModels = nextModels.map((model) => {
    const previousModel = previousBySlug.get(model.slug);
    if (
      !previousModel ||
      (provider.driver === "claudeAgent" && model.capabilities !== null) ||
      hasModelCapabilities(model) ||
      !hasModelCapabilities(previousModel)
    ) {
      return model;
    }
    return {
      ...model,
      capabilities: previousModel.capabilities,
    };
  });
  const nextSlugs = new Set(nextModels.map((model) => model.slug));
  return shouldRetainMissingModels
    ? [...mergedModels, ...retainablePreviousModels.filter((model) => !nextSlugs.has(model.slug))]
    : mergedModels;
};

const carrySavedAntigravityAccount = (
  previousProvider: ServerProvider,
  nextProvider: ServerProvider,
) => {
  const antigravity = ProviderDriverKind.make("antigravity");
  if (
    nextProvider.driver !== antigravity ||
    previousProvider.driver !== antigravity ||
    !nextProvider.enabled ||
    nextProvider.auth.status !== "unknown" ||
    previousProvider.auth.status !== "authenticated" ||
    (nextProvider.auth.type !== undefined &&
      nextProvider.auth.type !== previousProvider.auth.type) ||
    (!nextProvider.installed && nextProvider.status !== "warning")
  ) {
    return undefined;
  }
  const status =
    nextProvider.installed && nextProvider.status === "warning" ? "ready" : nextProvider.status;
  return { auth: previousProvider.auth, status };
};

export const mergeProviderSnapshot = (
  previousProvider: ServerProvider | undefined,
  nextProvider: ServerProvider,
) => {
  if (!previousProvider) {
    return nextProvider;
  }
  const savedAccount = carrySavedAntigravityAccount(previousProvider, nextProvider);
  const { message: _uncheckedMessage, ...nextWithoutMessage } = nextProvider;
  const models = mergeProviderModels(nextProvider, previousProvider.models, nextProvider.models);
  const previousWorkspaceSnapshots = Equal.equals(models, previousProvider.models)
    ? previousProvider.workspaceSnapshots
    : previousProvider.workspaceSnapshots?.map((snapshot) => ({
        ...snapshot,
        modelsPending: true,
      }));
  return {
    ...(savedAccount?.status === "ready" ? nextWithoutMessage : nextProvider),
    ...savedAccount,
    models,
    ...(nextProvider.workspaceSnapshots !== undefined
      ? { workspaceSnapshots: nextProvider.workspaceSnapshots }
      : previousWorkspaceSnapshots !== undefined
        ? { workspaceSnapshots: previousWorkspaceSnapshots }
        : {}),
    ...(nextProvider.workspaceRescannedAt === undefined &&
    previousProvider.workspaceRescannedAt !== undefined
      ? { workspaceRescannedAt: previousProvider.workspaceRescannedAt }
      : {}),
    ...(shouldRetainMissingOpenCodeMetadata(nextProvider)
      ? {
          slashCommands:
            nextProvider.slashCommands.length === 0
              ? previousProvider.slashCommands
              : nextProvider.slashCommands,
          skills: nextProvider.skills.length === 0 ? previousProvider.skills : nextProvider.skills,
        }
      : {}),
  };
};

const haveProvidersChanged = (
  previousProviders: ReadonlyArray<ServerProvider>,
  nextProviders: ReadonlyArray<ServerProvider>,
) => !Equal.equals(previousProviders, nextProviders);

const correlateSnapshotWithSource = (source: ProviderSnapshotSource, snapshot: ServerProvider) => {
  if (snapshot.instanceId !== source.instanceId) {
    return Effect.die(
      new Error(
        `Provider snapshot instance mismatch: source '${source.instanceId}' emitted '${snapshot.instanceId}'.`,
      ),
    );
  }
  if (snapshot.driver !== source.driverKind) {
    return Effect.die(
      new Error(
        `Provider snapshot driver mismatch for instance '${source.instanceId}': source '${source.driverKind}' emitted '${snapshot.driver}'.`,
      ),
    );
  }
  return Effect.succeed({
    ...snapshot,
    supportsReviewGuides: source.supportsReviewGuides === true,
  });
};

const snapshotInstanceKey = (provider: ServerProvider) => {
  return provider.instanceId;
};

const buildSnapshotSource = (instance: ProviderInstance) => ({
  supportsReviewGuides: instance.textGeneration.supportsReviewGuides === true,
  instanceId: instance.instanceId,
  driverKind: instance.driverKind,
  getSnapshot: instance.snapshot.getSnapshot,
  refresh: instance.snapshot.refresh,
  streamChanges: instance.snapshot.streamChanges,
});

export const layer = Layer.effect(
  ProviderRegistry,
  Effect.gen(function* () {
    const instanceRegistry = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
    const instanceRegistryMutator =
      yield* ProviderInstanceRegistryMutator.ProviderInstanceRegistryMutator;
    const manifestService = yield* ModelManifest.ModelManifest;
    const latestVersions = yield* ProviderLatestVersions.ProviderLatestVersions;
    const serviceScope = yield* Effect.scope;
    const config = yield* ServerConfig.ServerConfig;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const changesPubSub = yield* Effect.acquireRelease(
      PubSub.unbounded<ReadonlyArray<ServerProvider>>(),
      PubSub.shutdown,
    );

    const bootInstances = yield* instanceRegistry.listInstances;
    const bootSources = bootInstances.map(buildSnapshotSource);
    const fallbackProviders = yield* loadProviders(bootSources);
    const fallbackByInstance = new Map<ProviderInstanceId, ServerProvider>();
    for (let index = 0; index < fallbackProviders.length; index++) {
      const provider = fallbackProviders[index];
      const source = bootSources[index];
      if (provider === undefined || source === undefined) {
        continue;
      }
      fallbackByInstance.set(source.instanceId, provider);
    }
    const awaitingBootInstances = new Set<ProviderInstance>();
    for (const instance of bootInstances) {
      if (yield* instance.snapshot.isAwaitingFirstCheck ?? Effect.succeed(false)) {
        awaitingBootInstances.add(instance);
      }
    }

    const bootProviders = yield* Effect.forEach(
      bootSources,
      (source, index) =>
        Effect.gen(function* () {
          const filePath = yield* resolveProviderStatusCachePath({
            cacheDir: config.providerStatusCacheDir,
            instanceId: source.instanceId,
          }).pipe(Effect.provideService(Path.Path, path));
          const fallbackProvider = fallbackByInstance.get(source.instanceId);
          if (fallbackProvider === undefined) {
            return undefined;
          }
          const placeholder = awaitingBootInstances.has(bootInstances[index]!)
            ? fallbackProvider
            : undefined;
          return yield* readProviderStatusCache(filePath).pipe(
            Effect.provideService(FileSystem.FileSystem, fileSystem),
            Effect.flatMap((cachedProvider) => {
              if (cachedProvider === undefined) {
                return Effect.succeed(placeholder);
              }
              const correlation = {
                cachedProvider,
                fallbackProvider,
              } as const;
              if (!isCachedProviderCorrelated(correlation)) {
                return Effect.logWarning("provider status cache identity mismatch, ignoring", {
                  path: filePath,
                  instanceId: source.instanceId,
                  cachedInstanceId: cachedProvider.instanceId ?? null,
                  driver: source.driverKind,
                  cachedDriver: cachedProvider.driver ?? null,
                }).pipe(Effect.as(placeholder));
              }
              return Effect.succeed(hydrateCachedProvider(correlation));
            }),
          );
        }),
      { concurrency: "unbounded" },
    ).pipe(
      Effect.map((providers) =>
        orderProviderSnapshots(
          providers.filter((provider): provider is ServerProvider => provider !== undefined),
        ),
      ),
    );
    const initialManifest = yield* manifestService.current;
    const classifyCompatibility = (
      provider: ServerProvider,
      manifest: ModelManifest.ModelManifestData,
    ) =>
      applyProviderCompatibility(
        provider,
        manifest.compatibility,
        ModelManifest.BUNDLED_MODEL_MANIFEST.compatibility,
      );
    const providersRef = yield* Ref.make<ReadonlyArray<ServerProvider>>(
      bootProviders.map((provider) => classifyCompatibility(provider, initialManifest)),
    );
    const workspaceRefreshesRef = yield* Ref.make<
      ReadonlyMap<ProviderInstance, ReadonlyMap<string, Deferred.Deferred<void>>>
    >(new Map());
    const workspaceRescans = yield* Queue.unbounded<{
      readonly instance: ProviderInstance;
      readonly cwd: string;
    }>();
    const maintenanceActionStatesRef = yield* Ref.make<
      ReadonlyMap<
        ProviderInstanceId,
        { readonly update?: ServerProviderUpdateState; readonly targetVersion?: string | undefined }
      >
    >(new Map());

    const liveSubsRef = yield* Ref.make<ReadonlyMap<ProviderInstanceId, ProviderInstance>>(
      new Map(),
    );
    const syncSemaphore = yield* Semaphore.make(1);

    const persistProvider = Effect.fn("ProviderRegistry.persistProvider")(function* (
      provider: ServerProvider,
    ) {
      const key = snapshotInstanceKey(provider);
      const filePath = yield* resolveProviderStatusCachePath({
        cacheDir: config.providerStatusCacheDir,
        instanceId: key,
      }).pipe(Effect.provideService(Path.Path, path));
      const {
        workspaceSnapshots: _workspaceSnapshots,
        workspaceRescannedAt: _workspaceRescannedAt,
        ...machineProvider
      } = provider;
      yield* writeProviderStatusCache({ filePath, provider: machineProvider }).pipe(
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.provideService(Path.Path, path),
        Effect.tapError(Effect.logError),
        Effect.ignore,
      );
    });

    const applyProviderUpdateState = Effect.fn("applyProviderUpdateState")(function* (
      provider: ServerProvider,
    ) {
      const maintenanceActionStates = yield* Ref.get(maintenanceActionStatesRef);
      const updateState = maintenanceActionStates.get(provider.instanceId)?.update;
      if (!updateState) {
        const { updateState: _updateState, ...providerWithoutUpdateState } = provider;
        return providerWithoutUpdateState;
      }
      return {
        ...provider,
        updateState,
      };
    });

    const upsertProviders = Effect.fn("upsertProviders")(function* (
      nextProviders: ReadonlyArray<ServerProvider>,
      options?: {
        readonly publish?: boolean;
        readonly persist?: boolean;
        readonly replace?: boolean;
      },
    ) {
      const manifest = yield* manifestService.current;
      const nextProvidersWithUpdateState = yield* Effect.forEach(
        nextProviders,
        applyProviderUpdateState,
        {
          concurrency: "unbounded",
        },
      );
      const [previousProviders, providers, providersToPersist] = yield* Ref.modify(
        providersRef,
        (previousProviders) => {
          const mergedProviders = new Map(
            previousProviders.map((provider) => [snapshotInstanceKey(provider), provider] as const),
          );
          const updatedKeys = new Set<ProviderInstanceId>();

          for (const provider of nextProvidersWithUpdateState) {
            const key = snapshotInstanceKey(provider);
            updatedKeys.add(key);
            mergedProviders.set(
              key,
              options?.replace === true
                ? provider
                : mergeProviderSnapshot(mergedProviders.get(key), provider),
            );
          }

          const providers = orderProviderSnapshots(
            [...mergedProviders.values()].map((provider) =>
              classifyCompatibility(provider, manifest),
            ),
          );
          const providersToPersist = providers.filter((provider) =>
            updatedKeys.has(snapshotInstanceKey(provider)),
          );
          return [[previousProviders, providers, providersToPersist] as const, providers];
        },
      );

      if (haveProvidersChanged(previousProviders, providers)) {
        if (options?.persist !== false) {
          yield* Effect.forEach(providersToPersist, persistProvider, {
            concurrency: "unbounded",
            discard: true,
          });
        }
        if (options?.publish !== false) {
          yield* PubSub.publish(changesPubSub, yield* Ref.get(providersRef));
        }
      }

      return providers;
    });

    const compatibilityRefreshRunning = yield* Ref.make(false);
    const refreshCompatibility = Effect.gen(function* () {
      if (!(yield* Ref.getAndSet(compatibilityRefreshRunning, true))) {
        yield* manifestService.refresh.pipe(
          Effect.andThen(upsertProviders([], { persist: false })),
          Effect.ensuring(Ref.set(compatibilityRefreshRunning, false)),
          Effect.forkIn(serviceScope),
        );
      }
    });
    const syncProvider = Effect.fn("syncProvider")(function* (
      provider: ServerProvider,
      options?: {
        readonly publish?: boolean;
      },
    ) {
      if (provider.versionAdvisory?.status === "current") {
        yield* Ref.update(maintenanceActionStatesRef, (previous) => {
          const action = previous.get(provider.instanceId);
          if (
            action?.targetVersion !== undefined ||
            (action?.update?.status !== "unchanged" && action?.update?.status !== "failed")
          ) {
            return previous;
          }
          const next = new Map(previous);
          next.delete(provider.instanceId);
          return next;
        });
      }
      const providers = yield* upsertProviders([provider], options);
      yield* refreshCompatibility;
      return providers;
    });

    const setProviderMaintenanceActionState = Effect.fn("setProviderMaintenanceActionState")(
      function* (input: {
        readonly instanceId: ProviderInstanceId;
        readonly action: "update";
        readonly state: ServerProviderUpdateState | null;
        readonly targetVersion?: string | undefined;
      }) {
        yield* Ref.update(maintenanceActionStatesRef, (previous) => {
          const next = new Map(previous);
          if (input.state === null || input.state.status === "idle") {
            next.delete(input.instanceId);
          } else {
            next.set(input.instanceId, { update: input.state, targetVersion: input.targetVersion });
          }
          return next;
        });

        const existingProviders = yield* Ref.get(providersRef);
        const matchingProvider = existingProviders.find(
          (candidate) => candidate.instanceId === input.instanceId,
        );
        if (!matchingProvider) {
          return existingProviders;
        }

        const nextProvider = yield* applyProviderUpdateState(matchingProvider);
        return yield* upsertProviders([nextProvider], {
          persist: false,
        });
      },
    );

    const isCurrentInstance = (instance: ProviderInstance) =>
      instanceRegistry
        .getInstance(instance.instanceId)
        .pipe(Effect.map((current) => current === instance));

    const refreshOneSource = Effect.fn("refreshOneSource")(function* (instance: ProviderInstance) {
      const providerSource = buildSnapshotSource(instance);
      const probe = yield* providerSource.refresh.pipe(
        Effect.andThen(providerSource.getSnapshot),
        Effect.exit,
      );
      if (!(yield* isCurrentInstance(instance))) {
        return yield* Ref.get(providersRef);
      }
      const nextProvider = yield* probe;
      return yield* correlateSnapshotWithSource(providerSource, nextProvider).pipe(
        Effect.flatMap(syncProvider),
      );
    });

    type RefreshAllCompletion = Deferred.Deferred<ReadonlyArray<ServerProvider>>;
    const refreshHostPath = yield* refreshWindowsPath().pipe(
      Effect.flatMap((changed) =>
        changed
          ? Ref.get(providersRef).pipe(
              Effect.flatMap((providers) =>
                instanceRegistryMutator.rebuild(
                  providers
                    .filter((provider) => provider.enabled && !provider.installed)
                    .map((provider) => provider.instanceId),
                ),
              ),
            )
          : Effect.void,
      ),
      Effect.cachedWithTTL(Duration.seconds(10)),
    );
    const refreshAllInFlightRef = yield* Ref.make<Option.Option<RefreshAllCompletion>>(
      Option.none(),
    );

    const probedManifestUpdatedAt = yield* Ref.make(initialManifest.updatedAt);

    const refreshAll = Effect.fn("refreshAll")(function* () {
      yield* refreshHostPath;
      const claimed = yield* Ref.modify(refreshAllInFlightRef, (inFlight) => {
        if (Option.isSome(inFlight)) {
          return [{ owner: false, completion: inFlight.value }, inFlight];
        }
        const completion = Deferred.makeUnsafe<ReadonlyArray<ServerProvider>>();
        return [{ owner: true, completion }, Option.some(completion)];
      });
      if (claimed.owner) {
        yield* manifestService.current.pipe(
          Effect.flatMap(({ updatedAt }) =>
            syncLiveSourcesAndContinue.pipe(
              Effect.andThen(Ref.get(liveSubsRef)),
              Effect.flatMap((instances) =>
                Effect.forEach(instances.values(), (instance) => refreshOneSource(instance), {
                  concurrency: "unbounded",
                  discard: true,
                }),
              ),
              Effect.andThen(Ref.get(providersRef)),
              Effect.tap(() => Ref.set(probedManifestUpdatedAt, updatedAt)),
            ),
          ),
          Effect.onExit((exit) =>
            Ref.set(refreshAllInFlightRef, Option.none()).pipe(
              Effect.andThen(Deferred.done(claimed.completion, exit)),
            ),
          ),
          Effect.forkDetach,
        );
      }
      return yield* Deferred.await(claimed.completion);
    });

    const refresh = Effect.fn("refresh")(function* (provider?: ProviderDriverKind) {
      if (provider === undefined) {
        return yield* refreshAll();
      }
      return yield* refreshInstance(defaultInstanceIdForDriver(provider));
    });

    const refreshInstance = Effect.fn("refreshInstance")(function* (
      instanceId: ProviderInstanceId,
    ) {
      yield* refreshHostPath;
      yield* syncLiveSourcesAndContinue;
      const instance = (yield* Ref.get(liveSubsRef)).get(instanceId);
      if (!instance) {
        return yield* Ref.get(providersRef);
      }
      return yield* refreshOneSource(instance);
    });

    const refreshAfterUpdate = Effect.fn("refreshAfterUpdate")(function* (
      provider: ProviderDriverKind,
      selectedInstanceId: ProviderInstanceId,
    ) {
      yield* manifestService.forceRefresh;
      const instances = (yield* instanceRegistry.listInstances).filter(
        (instance) =>
          instance.driverKind === provider &&
          (instance.enabled || instance.instanceId === selectedInstanceId),
      );
      const failedInstances = new Set<ProviderInstanceId>();
      const recoverInstanceFailure = Effect.fn("recoverPostUpdateRefreshFailure")(function* (
        instanceId: ProviderInstanceId,
        cause: Cause.Cause<unknown>,
      ) {
        if (Cause.hasInterruptsOnly(cause)) {
          return yield* Effect.interrupt;
        }
        yield* Effect.logError("provider post-update refresh failed", {
          instanceId,
          cause: Cause.pretty(cause),
        });
        failedInstances.add(instanceId);
        return yield* updateProviders((providers) =>
          providers.map((candidate) =>
            candidate.instanceId === instanceId
              ? { ...candidate, status: "error", message: "Provider refresh failed after update." }
              : candidate,
          ),
        );
      });
      const selectedInstance = instances.find(
        (instance) => instance.instanceId === selectedInstanceId,
      );
      if (selectedInstance?.afterUpdate !== undefined) {
        yield* selectedInstance.afterUpdate.pipe(
          Effect.catchCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.interrupt
              : Effect.logError("provider post-update hook failed", {
                  instanceId: selectedInstance.instanceId,
                  cause: Cause.pretty(cause),
                }),
          ),
        );
      }
      yield* Effect.forEach(
        instances,
        (instance) =>
          Effect.gen(function* () {
            yield* instance.invalidateCaches ?? Effect.void;
            const maintenance = yield* instance.snapshot.resolveMaintenance({ fresh: true });
            yield* Effect.forEach(
              latestProviderVersionCacheKeys(maintenance),
              latestVersions.invalidate,
              { discard: true },
            );
          }).pipe(Effect.catchCause((cause) => recoverInstanceFailure(instance.instanceId, cause))),
        { concurrency: "unbounded", discard: true },
      );
      yield* Effect.forEach(
        instances.filter((instance) => !failedInstances.has(instance.instanceId)),
        (instance) =>
          refreshOneSource(instance).pipe(
            Effect.catchCause((cause) => recoverInstanceFailure(instance.instanceId, cause)),
          ),
        { concurrency: "unbounded", discard: true },
      );
      const refreshedInstances = yield* Effect.filter(
        instances.filter((instance) => !failedInstances.has(instance.instanceId)),
        isCurrentInstance,
      );
      const refreshedInstanceIds = new Set(
        refreshedInstances.map((instance) => instance.instanceId),
      );
      return (yield* Ref.get(providersRef)).filter((candidate) =>
        refreshedInstanceIds.has(candidate.instanceId),
      );
    });

    const getProviderMaintenanceCapabilitiesForInstance = Effect.fn(
      "getProviderMaintenanceCapabilitiesForInstance",
    )(function* (
      instanceId: ProviderInstanceId,
      provider: ProviderDriverKind,
      options?: { readonly fresh?: boolean },
    ) {
      const instance = yield* instanceRegistry.getInstance(instanceId);
      if (!instance || instance.driverKind !== provider) {
        return makeManualProviderMaintenanceCapabilities(provider);
      }
      return yield* instance.snapshot.resolveMaintenance(options);
    });

    const syncLiveSources = syncSemaphore.withPermits(1)(
      Effect.gen(function* () {
        const instances = yield* instanceRegistry.listInstances;
        const unavailableProviders = yield* instanceRegistry.listUnavailable;
        const nextByInstance = new Map<ProviderInstanceId, ProviderInstance>(
          instances.map((instance) => [instance.instanceId, instance] as const),
        );
        const knownInstanceIds = new Set<ProviderInstanceId>(nextByInstance.keys());
        for (const provider of unavailableProviders) {
          knownInstanceIds.add(snapshotInstanceKey(provider));
        }
        const previousSubs = yield* Ref.get(liveSubsRef);

        const carriedOver = new Map<ProviderInstanceId, ProviderInstance>();
        for (const [instanceId, previousInstance] of previousSubs) {
          const nextInstance = nextByInstance.get(instanceId);
          if (nextInstance !== undefined && nextInstance === previousInstance) {
            carriedOver.set(instanceId, previousInstance);
          }
        }

        const newlyAdded: Array<readonly [ProviderInstanceId, ProviderInstance]> = [];
        for (const [instanceId, instance] of nextByInstance) {
          if (carriedOver.has(instanceId)) {
            continue;
          }
          newlyAdded.push([instanceId, instance] as const);
        }

        const rebuiltInstanceIds = new Set(
          newlyAdded.flatMap(([instanceId]) => (previousSubs.has(instanceId) ? [instanceId] : [])),
        );
        if (rebuiltInstanceIds.size > 0) {
          const [previousProviders, providers] = yield* Ref.modify(
            providersRef,
            (previousProviders) => {
              const providers = previousProviders.map((provider) => {
                if (!rebuiltInstanceIds.has(provider.instanceId)) return provider;
                const { workspaceSnapshots: _workspaceSnapshots, ...machineSnapshot } = provider;
                return machineSnapshot;
              });
              return [[previousProviders, providers] as const, providers];
            },
          );
          if (haveProvidersChanged(previousProviders, providers)) {
            yield* PubSub.publish(changesPubSub, providers);
          }
        }

        for (const [, instance] of newlyAdded) {
          const source = buildSnapshotSource(instance);
          yield* Stream.runForEach(source.streamChanges, (provider) =>
            correlateSnapshotWithSource(source, provider).pipe(Effect.flatMap(syncProvider)),
          ).pipe(Effect.forkScoped);
          if (instance.workspaceRescans) {
            yield* Stream.runForEach(instance.workspaceRescans, (cwd) =>
              Queue.offer(workspaceRescans, { instance, cwd }),
            ).pipe(Effect.forkScoped);
          }
        }
        yield* Effect.yieldNow;

        yield* Effect.forEach(
          newlyAdded,
          ([, instance]) =>
            Effect.gen(function* () {
              const source = buildSnapshotSource(instance);
              const provider = yield* source.getSnapshot;
              if (
                awaitingBootInstances.has(instance) &&
                (yield* instance.snapshot.isAwaitingFirstCheck ?? Effect.succeed(false))
              ) {
                return yield* refreshCompatibility;
              }
              yield* correlateSnapshotWithSource(source, provider).pipe(
                Effect.flatMap(syncProvider),
              );
            }).pipe(Effect.ignoreCause({ log: true })),
          { concurrency: "unbounded", discard: true },
        );
        yield* upsertProviders(unavailableProviders, {
          persist: false,
          replace: true,
        });

        const nextSubs = new Map(carriedOver);
        for (const [instanceId, instance] of newlyAdded) {
          nextSubs.set(instanceId, instance);
        }
        yield* Ref.set(liveSubsRef, nextSubs);

        const [previousProviders, providers] = yield* Ref.modify(
          providersRef,
          (previousProviders) => {
            const providers = orderProviderSnapshots(
              previousProviders.filter((provider) =>
                knownInstanceIds.has(snapshotInstanceKey(provider)),
              ),
            );
            return [[previousProviders, providers] as const, providers];
          },
        );
        if (haveProvidersChanged(previousProviders, providers)) {
          yield* PubSub.publish(changesPubSub, providers);
        }
        yield* Ref.update(maintenanceActionStatesRef, (previous) => {
          const next = new Map(previous);
          for (const instanceId of previous.keys()) {
            if (!knownInstanceIds.has(instanceId)) {
              next.delete(instanceId);
            }
          }
          return next;
        });
      }),
    );
    const syncLiveSourcesAndContinue = syncLiveSources.pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.interrupt;
        }
        return Effect.logError(
          "provider registry instance sync failed; keeping subscription alive",
          {
            cause: Cause.pretty(cause),
          },
        );
      }),
      Scope.provide(serviceScope),
    );

    yield* upsertProviders(
      fallbackProviders.filter((_, index) => !awaitingBootInstances.has(bootInstances[index]!)),
      { publish: false },
    );
    const instanceChanges = yield* instanceRegistry.subscribeChanges;
    yield* syncLiveSources;
    yield* Stream.runForEach(
      Stream.fromSubscription(instanceChanges),
      () => syncLiveSourcesAndContinue,
    ).pipe(Effect.forkScoped);

    const recoverRefreshFailure = Effect.fn("recoverRefreshFailure")(function* (
      cause: Cause.Cause<unknown>,
    ) {
      if (Cause.hasInterruptsOnly(cause)) {
        return yield* Effect.interrupt;
      }
      yield* Effect.logError("provider registry refresh failed; preserving cached providers", {
        cause: Cause.pretty(cause),
      });
      return yield* Ref.get(providersRef);
    });

    const updateProviders = (
      update: (providers: ReadonlyArray<ServerProvider>) => ReadonlyArray<ServerProvider>,
    ) =>
      Ref.modify(providersRef, (currentProviders) => {
        const nextProviders = update(currentProviders);
        return [[currentProviders, nextProviders] as const, nextProviders];
      }).pipe(
        Effect.tap(([previousProviders, nextProviders]) =>
          haveProvidersChanged(previousProviders, nextProviders)
            ? PubSub.publish(changesPubSub, nextProviders)
            : Effect.void,
        ),
        Effect.map(([, nextProviders]) => nextProviders),
      );

    const refreshWorkspaceSnapshot = Effect.fn("refreshWorkspaceSnapshot")(function* (input: {
      readonly instanceId: ProviderInstanceId;
      readonly cwd: string;
      readonly scanCwd?: string;
      readonly fresh?: boolean;
      readonly rescan?: ProviderInstance;
    }) {
      const workspaceSnapshotOf = (candidate: ServerProvider | undefined) =>
        candidate?.workspaceSnapshots?.find((s) => s.cwd === input.cwd);
      const heldBeforeWait = input.rescan
        ? workspaceSnapshotOf(
            (yield* Ref.get(providersRef)).find(
              (candidate) => candidate.instanceId === input.instanceId,
            ),
          )
        : undefined;
      const runningScan = input.rescan
        ? (yield* Ref.get(workspaceRefreshesRef)).get(input.rescan)?.get(input.cwd)
        : undefined;
      if (runningScan) yield* Deferred.await(runningScan);
      if (input.fresh) {
        yield* updateProviders((providers) =>
          providers.map((candidate) =>
            candidate.instanceId === input.instanceId
              ? candidate
              : dropProviderWorkspaceSnapshot(candidate, input.cwd),
          ),
        );
      }
      const providers = yield* Ref.get(providersRef);
      const provider = providers.find((candidate) => candidate.instanceId === input.instanceId);
      const scannedFrom = workspaceSnapshotOf(provider);
      const now = yield* DateTime.now;
      if (
        !provider ||
        !provider.enabled ||
        (!input.fresh &&
          !input.rescan &&
          scannedFrom &&
          !isProviderWorkspaceSnapshotPending(scannedFrom) &&
          isProviderWorkspaceSnapshotCurrent(scannedFrom, DateTime.toEpochMillis(now)))
      ) {
        return providers;
      }
      const scannedAt = DateTime.formatIso(now);
      const instance = yield* instanceRegistry.getInstance(input.instanceId);
      const snapshotForCwd = instance?.snapshotForCwd;
      if (!instance || !snapshotForCwd) return providers;
      if (input.rescan && (input.rescan !== instance || (!runningScan && !scannedFrom))) {
        return providers;
      }
      const token = yield* Deferred.make<void>();
      const refreshMachineSnapshot = input.fresh
        ? (instance.invalidateCaches ?? Effect.void).pipe(
            Effect.andThen(refreshInstance(input.instanceId)),
            Effect.andThen(Ref.get(providersRef)),
            Effect.map((current) =>
              workspaceSnapshotOf(
                current.find((candidate) => candidate.instanceId === input.instanceId),
              ),
            ),
          )
        : Effect.succeed(scannedFrom);
      const runScan = refreshMachineSnapshot.pipe(
        Effect.flatMap((scanBase) =>
          Effect.map(snapshotForCwd(input.scanCwd ?? input.cwd), (scopedSnapshot) => ({
            scanBase,
            scopedSnapshot,
          })),
        ),
        Effect.flatMap(({ scanBase, scopedSnapshot }) =>
          instanceRegistry.getInstance(input.instanceId).pipe(
            Effect.flatMap((currentInstance) => {
              if (currentInstance !== instance) return Ref.get(providersRef);
              return updateProviders((currentProviders) => {
                if (Ref.getUnsafe(workspaceRefreshesRef).get(instance)?.get(input.cwd) !== token) {
                  return currentProviders;
                }
                return currentProviders.map((candidate) => {
                  if (
                    candidate.instanceId !== input.instanceId ||
                    !Equal.equals(workspaceSnapshotOf(candidate), scanBase)
                  ) {
                    return candidate;
                  }
                  const scanned = upsertProviderWorkspaceSnapshot(candidate, input.cwd, {
                    ...scopedSnapshot,
                    checkedAt: scannedAt,
                    slashCommandsPending:
                      scopedSnapshot.slashCommandsPending ?? scopedSnapshot.status === "error",
                  });
                  const rescanned = workspaceSnapshotOf(scanned);
                  const held = heldBeforeWait ?? scanBase;
                  return input.rescan &&
                    !(
                      Equal.equals(rescanned?.skills, held?.skills) &&
                      Equal.equals(rescanned?.slashCommands, held?.slashCommands)
                    )
                    ? { ...scanned, workspaceRescannedAt: scannedAt }
                    : scanned;
                });
              });
            }),
          ),
        ),
        Effect.ensuring(
          Ref.update(workspaceRefreshesRef, (refreshes) => {
            const current = refreshes.get(instance);
            if (current?.get(input.cwd) !== token) return refreshes;
            const next = new Map(refreshes);
            const nextCwds = new Map(current);
            nextCwds.delete(input.cwd);
            if (nextCwds.size) next.set(instance, nextCwds);
            else next.delete(instance);
            return next;
          }).pipe(Effect.andThen(Deferred.succeed(token, undefined))),
        ),
      );
      const claim = yield* Effect.uninterruptible(
        Effect.gen(function* () {
          const inFlight = yield* Ref.modify(workspaceRefreshesRef, (refreshes) => {
            const current = refreshes.get(instance);
            const running = current?.get(input.cwd);
            if (!input.fresh && running) return [running, refreshes] as const;
            const next = new Map(refreshes);
            next.set(instance, new Map(current).set(input.cwd, token));
            return [undefined, next] as const;
          });
          if (inFlight) return { inFlight } as const;
          return {
            scan: yield* Effect.forkIn(runScan, serviceScope, { startImmediately: true }),
          } as const;
        }),
      );
      if ("inFlight" in claim) {
        return yield* Deferred.await(claim.inFlight).pipe(Effect.andThen(Ref.get(providersRef)));
      }
      return yield* Fiber.join(claim.scan);
    });
    yield* Stream.runForEach(Stream.fromQueue(workspaceRescans), ({ instance, cwd }) =>
      refreshWorkspaceSnapshot({ instanceId: instance.instanceId, cwd, rescan: instance }).pipe(
        Effect.ignoreCause({ log: true }),
      ),
    ).pipe(Effect.forkScoped);

    const invalidateModelCaches = Effect.fn("ProviderRegistry.invalidateModelCaches")(function* (
      input: Parameters<ProviderRegistry["Service"]["invalidateModelCaches"]>[0],
    ) {
      yield* manifestService.forceRefresh;
      const instances = yield* instanceRegistry.listInstances;
      yield* Effect.forEach(
        instances.filter(
          (instance) => input.instanceId === undefined || input.instanceId === instance.instanceId,
        ),
        (instance) =>
          Effect.gen(function* () {
            yield* instance.invalidateCaches ?? Effect.void;
            const maintenance = yield* instance.snapshot.resolveMaintenance({
              fresh:
                input.instanceId !== undefined && input.cwd !== undefined && input.fresh !== true,
            });
            yield* Effect.forEach(
              latestProviderVersionCacheKeys(maintenance),
              latestVersions.invalidate,
              { discard: true },
            );
          }),
        { concurrency: "unbounded", discard: true },
      );
    });

    const refreshModelCatalog = Effect.fn("ProviderRegistry.refreshModelCatalog")(function* () {
      const { updatedAt } = yield* manifestService.refreshOnDemand;
      for (let pass = 0; pass < 2; pass++) {
        if ((yield* Ref.get(probedManifestUpdatedAt)) === updatedAt) return;
        yield* latestVersions.invalidateAll;
        yield* refreshAll();
      }
    });

    return {
      getProviders: Ref.get(providersRef),
      refresh: (provider?: ProviderDriverKind) =>
        refresh(provider).pipe(Effect.catchCause(recoverRefreshFailure)),
      refreshInstance: (instanceId: ProviderInstanceId) =>
        refreshInstance(instanceId).pipe(Effect.catchCause(recoverRefreshFailure)),
      refreshWorkspaceSnapshot: (input) =>
        refreshWorkspaceSnapshot(input).pipe(Effect.catchCause(recoverRefreshFailure)),
      refreshAfterUpdate,
      invalidateModelCaches,
      refreshModelCatalog: refreshModelCatalog().pipe(
        Effect.catchCause(recoverRefreshFailure),
        Effect.asVoid,
      ),
      getProviderMaintenanceCapabilitiesForInstance,
      setProviderMaintenanceActionState,
      get streamChanges() {
        return Stream.fromPubSub(changesPubSub);
      },
    } satisfies ProviderRegistry["Service"];
  }),
);
