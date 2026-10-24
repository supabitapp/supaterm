import { RelayGateway } from "../relay/gateway.ts";
import {
  type DesktopSshEnvironmentTarget,
  EnvironmentId,
  DEFAULT_SERVER_SETTINGS,
  type ServerConfig,
  type OrchestrationV2ShellSnapshot,
  ORCHESTRATION_PROTOCOL_VERSION,
} from "@supaterm/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Queue from "effect/Queue";
import { connectionRoutes, isLearned } from "./routes.ts";
import * as Result from "effect/Result";
import * as Scheduler from "effect/Scheduler";
import * as Scope from "effect/Scope";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import * as ClientCapabilities from "../platform/capabilities.ts";
import {
  BearerConnectionCredential,
  BearerConnectionProfile,
  BearerConnectionRegistration,
  type ConnectionRegistration,
  type ConnectionRoute,
  PrimaryConnectionRegistration,
  SshConnectionProfile,
  type ConnectionCredential,
  type ConnectionProfile,
} from "./catalog.ts";
import * as Connectivity from "./connectivity.ts";
import * as ConnectionCredentialStore from "./credentialStore.ts";
import * as ConnectionDriver from "./driver.ts";
import type { RouteCheck } from "./driver.ts";
import {
  ConnectionTransientError,
  ConnectionBlockedError,
  BearerConnectionTarget,
  PrimaryConnectionTarget,
  SshConnectionTarget,
  type ConnectionTarget,
  type PreparedConnection,
  type SupervisorConnectionState,
} from "./model.ts";
import * as Persistence from "../platform/persistence.ts";
import {
  ConnectionCatalogDocument,
  EMPTY_CONNECTION_CATALOG_DOCUMENT,
  type StoredPlatformLabel,
  setPlatformLabelInCatalog,
  setRoutesInCatalog,
} from "../platform/storageDocument.ts";
import * as ConnectionProfileStore from "./profileStore.ts";
import * as EnvironmentRegistry from "./registry.ts";
import {
  PullRequestRoutingPermissions,
  makePullRequestRoutingPermissions,
} from "./pullRequestRoutingPermissions.ts";
import * as RpcSession from "../rpc/session.ts";
import * as EnvironmentSupervisor from "./supervisor.ts";
import * as ConnectionWakeups from "./wakeups.ts";
import { runDesktopCommitWithReconnectObserver } from "../state/server.ts";
import { v2ShellSnapshot } from "../state/orchestrationV2TestFixtures.ts";

const decodeConnectionCatalogDocument = Schema.decodeEffect(ConnectionCatalogDocument);

const TARGET = new PrimaryConnectionTarget({
  environmentId: EnvironmentId.make("environment-1"),
  label: "Test environment",
  httpBaseUrl: "https://environment.example.test",
  wsBaseUrl: "wss://environment.example.test",
});
const SECOND_TARGET = new PrimaryConnectionTarget({
  environmentId: EnvironmentId.make("environment-2"),
  label: "Second environment",
  httpBaseUrl: "https://environment-2.example.test",
  wsBaseUrl: "wss://environment-2.example.test",
});

const PREPARED: PreparedConnection = {
  environmentId: TARGET.environmentId,
  label: TARGET.label,
  httpBaseUrl: TARGET.httpBaseUrl,
  socketUrl: "wss://environment.example.test/ws",
  httpAuthorization: null,
  target: TARGET,
};

const BEARER_TARGET = new BearerConnectionTarget({
  environmentId: EnvironmentId.make("environment-bearer"),
  label: "Bearer environment",
  connectionId: "bearer-connection",
});
const BEARER_PROFILE = new BearerConnectionProfile({
  connectionId: BEARER_TARGET.connectionId,
  environmentId: BEARER_TARGET.environmentId,
  label: BEARER_TARGET.label,
  httpBaseUrl: "https://bearer.example.test",
  wsBaseUrl: "wss://bearer.example.test",
});
const BEARER_CREDENTIAL = new BearerConnectionCredential({
  token: "bearer-token",
});

const REMOTE_TARGET = new BearerConnectionTarget({
  environmentId: EnvironmentId.make("environment-remote"),
  label: "Remote environment",
  connectionId: "remote-connection",
});

function remoteProfile(target: BearerConnectionTarget) {
  return new BearerConnectionProfile({
    connectionId: target.connectionId,
    environmentId: target.environmentId,
    label: target.label,
    httpBaseUrl: "https://remote.example.test",
    wsBaseUrl: "wss://remote.example.test",
  });
}

function remoteRegistration(target: BearerConnectionTarget) {
  return new BearerConnectionRegistration({
    target,
    profile: remoteProfile(target),
    credential: BEARER_CREDENTIAL,
  });
}

const SSH_TARGET: DesktopSshEnvironmentTarget = {
  alias: "test",
  hostname: "test.example.test",
  username: "developer",
  port: 22,
};
const SSH_CONNECTION = new SshConnectionTarget({
  environmentId: EnvironmentId.make("environment-ssh"),
  label: "SSH environment",
  connectionId: "ssh-connection",
});
const SSH_PROFILE = new SshConnectionProfile({
  connectionId: SSH_CONNECTION.connectionId,
  environmentId: SSH_CONNECTION.environmentId,
  label: SSH_CONNECTION.label,
  target: SSH_TARGET,
});

const CACHED_SNAPSHOT: OrchestrationV2ShellSnapshot = {
  ...v2ShellSnapshot,
  snapshotSequence: 1,
};

interface SessionControl {
  readonly closed: Deferred.Deferred<never, ConnectionTransientError>;
}

const makeHarness = Effect.fn("TestEnvironmentRegistry.makeHarness")(function* (
  initialTargets: ReadonlyArray<ConnectionTarget>,
  initialProfiles: ReadonlyArray<ConnectionProfile> = [],
  initialCredentials: ReadonlyArray<readonly [string, ConnectionCredential]> = [],
  options?: {
    readonly prepareError?: ConnectionBlockedError;
    readonly configChanges?: Stream.Stream<ServerConfig>;
    readonly setRoutes?: Persistence.ConnectionRegistrationStore["Service"]["setRoutes"];
    readonly checkRoute?: (route: ConnectionRoute) => RouteCheck;
    readonly prepareRoute?: (target: ConnectionTarget) => ConnectionBlockedError | undefined;
    /** Runs before preparing a connection; may suspend to hold an attempt in flight. */
    readonly beforePrepareRoute?: (
      target: ConnectionTarget,
    ) => Effect.Effect<ConnectionBlockedError | undefined>;
    readonly beforeSessionConnect?: (environmentId: EnvironmentId) => Effect.Effect<void>;
    readonly beforeRegistrationRegister?: (
      registration: ConnectionRegistration,
    ) => Effect.Effect<void, Persistence.ConnectionPersistenceError>;
    readonly beforeRegistrationRemove?: (
      target: ConnectionTarget,
    ) => Effect.Effect<void, Persistence.ConnectionPersistenceError>;
    readonly initialDisabled?: ReadonlyArray<EnvironmentId>;
    readonly initialPlatformLabels?: ReadonlyArray<StoredPlatformLabel>;
    readonly setPlatformLabel?: Persistence.ConnectionRegistrationStore["Service"]["setPlatformLabel"];

    readonly directEndpoints?: ServerConfig["directEndpoints"];
  },
) {
  const storedTargets = yield* Ref.make(
    new Map(initialTargets.map((target) => [target.environmentId, target])),
  );
  const shellCache = yield* Ref.make(new Map([[TARGET.environmentId, CACHED_SNAPSHOT]]));
  const cacheClears = yield* Ref.make<ReadonlyArray<EnvironmentId>>([]);
  const ownedDataClears = yield* Ref.make<ReadonlyArray<EnvironmentId>>([]);
  const sessions = yield* Ref.make<ReadonlyArray<SessionControl>>([]);
  const releasedSessions = yield* Ref.make(0);
  const storedProfiles = yield* Ref.make(
    new Map(initialProfiles.map((profile) => [profile.connectionId, profile])),
  );
  const profileReadCount = yield* Ref.make(0);
  const storedCredentials = yield* Ref.make(new Map(initialCredentials));
  const disconnectedSshTargets = yield* Ref.make<ReadonlyArray<DesktopSshEnvironmentTarget>>([]);

  const storedDisabled = yield* Ref.make<ReadonlySet<EnvironmentId>>(
    new Set(options?.initialDisabled ?? []),
  );
  const storedPlatformLabels = yield* Ref.make(options?.initialPlatformLabels ?? []);
  const targetStore = Persistence.ConnectionTargetStore.of({
    list: Ref.get(storedTargets).pipe(Effect.map((targets) => [...targets.values()])),
    listDisabled: Ref.get(storedDisabled).pipe(Effect.map((ids) => [...ids])),
    listPlatformLabels: Ref.get(storedPlatformLabels),
  });
  const registrationStore = Persistence.ConnectionRegistrationStore.of({
    setPlatformLabel: (environmentId, label) =>
      Effect.gen(function* () {
        yield* options?.setPlatformLabel?.(environmentId, label) ?? Effect.void;
        yield* Ref.update(
          storedPlatformLabels,
          (platformLabels) =>
            setPlatformLabelInCatalog(
              { ...EMPTY_CONNECTION_CATALOG_DOCUMENT, platformLabels },
              environmentId,
              label,
            ).platformLabels,
        );
      }),
    setRoutes: options?.setRoutes ?? (() => Effect.void),
    register: (registration) =>
      Effect.gen(function* () {
        yield* options?.beforeRegistrationRegister?.(registration) ?? Effect.void;
        yield* Ref.update(storedTargets, (current) => {
          const next = new Map(current);
          next.set(registration.target.environmentId, registration.target);
          return next;
        });
        switch (registration._tag) {
          case "BearerConnectionRegistration":
          case "SshConnectionRegistration":
            yield* Ref.update(storedProfiles, (current) => {
              const next = new Map(current);
              next.set(registration.profile.connectionId, registration.profile);
              return next;
            });
            yield* Ref.update(storedCredentials, (current) => {
              const next = new Map(current);
              next.set(registration.target.connectionId, registration.credential);
              return next;
            });
            return;
        }
      }),
    remove: (target) =>
      Effect.gen(function* () {
        yield* options?.beforeRegistrationRemove?.(target) ?? Effect.void;
        yield* Ref.update(storedTargets, (current) => {
          const next = new Map(current);
          next.delete(target.environmentId);
          return next;
        });
        if (target._tag === "BearerConnectionTarget" || target._tag === "SshConnectionTarget") {
          yield* Ref.update(storedProfiles, (current) => {
            const next = new Map(current);
            next.delete(target.connectionId);
            return next;
          });
          yield* Ref.update(storedCredentials, (current) => {
            const next = new Map(current);
            next.delete(target.connectionId);
            return next;
          });
        }
      }),
    setEnabled: (environmentId, enabled) =>
      Ref.update(storedDisabled, (current) => {
        const next = new Set(current);
        if (enabled) {
          next.delete(environmentId);
        } else {
          next.add(environmentId);
        }
        return next;
      }),
  });
  const cacheStore = Persistence.EnvironmentCacheStore.of({
    loadShell: (environmentId) =>
      Ref.get(shellCache).pipe(
        Effect.map((cache) => Option.fromUndefinedOr(cache.get(environmentId))),
      ),
    saveShell: (environmentId, snapshot) =>
      Ref.update(shellCache, (current) => {
        const next = new Map(current);
        next.set(environmentId, snapshot);
        return next;
      }),
    loadThread: (_environmentId, _threadId) => Effect.succeedNone,
    saveThread: (_environmentId, _thread) => Effect.void,
    removeThread: (_environmentId, _threadId) => Effect.void,
    loadServerConfig: () => Effect.succeedNone,
    saveServerConfig: () => Effect.void,
    loadVcsRefs: () => Effect.succeedNone,
    saveVcsRefs: () => Effect.void,
    removeVcsRefs: () => Effect.void,
    clearVcsRefs: () => Effect.void,
    clear: (environmentId) =>
      Ref.update(shellCache, (current) => {
        const next = new Map(current);
        next.delete(environmentId);
        return next;
      }).pipe(
        Effect.andThen(
          Ref.update(cacheClears, (environmentIds) => [...environmentIds, environmentId]),
        ),
      ),
  });
  const ownedDataCleanup = Persistence.EnvironmentOwnedDataCleanup.of({
    clear: (environmentId) =>
      Ref.update(ownedDataClears, (environmentIds) => [...environmentIds, environmentId]),
  });
  const networkStatus = yield* SubscriptionRef.make<"unknown" | "offline" | "online">("online");
  const connectivity = Connectivity.Connectivity.of({
    status: SubscriptionRef.get(networkStatus),
    changes: SubscriptionRef.changes(networkStatus),
  });
  const profileStore = ConnectionProfileStore.ConnectionProfileStore.of({
    get: (connectionId) =>
      Ref.update(profileReadCount, (count) => count + 1).pipe(
        Effect.andThen(Ref.get(storedProfiles)),
        Effect.map((current) => Option.fromUndefinedOr(current.get(connectionId))),
      ),
    put: (profile) =>
      Ref.update(storedProfiles, (current) => {
        const next = new Map(current);
        next.set(profile.connectionId, profile);
        return next;
      }),
    remove: (connectionId) =>
      Ref.update(storedProfiles, (current) => {
        const next = new Map(current);
        next.delete(connectionId);
        return next;
      }),
  });
  const credentialStore = ConnectionCredentialStore.ConnectionCredentialStore.of({
    get: (connectionId) =>
      Ref.get(storedCredentials).pipe(
        Effect.map((current) => Option.fromUndefinedOr(current.get(connectionId))),
      ),
    put: (connectionId, credential) =>
      Ref.update(storedCredentials, (current) => {
        const next = new Map(current);
        next.set(connectionId, credential);
        return next;
      }),
    remove: (connectionId) =>
      Ref.update(storedCredentials, (current) => {
        const next = new Map(current);
        next.delete(connectionId);
        return next;
      }),
  });
  const sshGateway = ClientCapabilities.SshEnvironmentGateway.of({
    provision: () => Effect.die(new Error("SSH provisioning is not used.")),
    prepare: () => Effect.die(new Error("SSH preparation is not used.")),
    disconnect: (target) => Ref.update(disconnectedSshTargets, (current) => [...current, target]),
  });
  const driver = ConnectionDriver.ConnectionDriver.of({
    checkRoute: () => Effect.succeed("unchecked"),
    preflight: () => Effect.succeedNone,
    connect: (entry, reportProgress) =>
      Effect.gen(function* () {
        const target = entry.target;
        const credential =
          target._tag === "BearerConnectionTarget"
            ? yield* credentialStore.get(target.connectionId)
            : Option.none();
        const prepared: PreparedConnection = {
          ...PREPARED,
          environmentId: target.environmentId,
          label: target.label,
          httpAuthorization: Option.isSome(credential)
            ? { _tag: "Bearer", token: credential.value.token }
            : null,
          target,
        };
        yield* reportProgress({ stage: "preparing" });
        if (options?.prepareError) return yield* options.prepareError;
        const heldError = options?.beforePrepareRoute
          ? yield* options.beforePrepareRoute(target)
          : undefined;
        if (heldError !== undefined) return yield* heldError;
        yield* reportProgress({ stage: "opening", prepared });
        yield* options?.beforeSessionConnect?.(target.environmentId) ?? Effect.void;
        const closed = yield* Deferred.make<never, ConnectionTransientError>();
        yield* Ref.update(sessions, (current) => [...current, { closed }]);
        const session = yield* Effect.acquireRelease(
          Effect.succeed({
            client: {} as RpcSession.RpcSession["client"],
            initialConfig: Effect.die(new Error("Config is not used by registry tests.")),
            configChanges: options?.configChanges ?? Stream.empty,
            subscribeServerConfig: () =>
              Stream.die(new Error("Config is not used by registry tests.")),
            ready: Effect.void,
            probe: Effect.void,
            closed: Deferred.await(closed),
          } satisfies RpcSession.RpcSession),
          () => Ref.update(releasedSessions, (count) => count + 1),
        );
        yield* reportProgress({ stage: "synchronizing", prepared });
        yield* session.ready;
        return { prepared, session };
      }),
  });

  const layerCache = Layer.succeed(Persistence.EnvironmentCacheStore, cacheStore);
  const layer = EnvironmentRegistry.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(Persistence.ConnectionTargetStore, targetStore),
        Layer.succeed(Persistence.ConnectionRegistrationStore, registrationStore),
        Layer.succeed(ConnectionProfileStore.ConnectionProfileStore, profileStore),
        Layer.succeed(ConnectionCredentialStore.ConnectionCredentialStore, credentialStore),
        Layer.succeed(ClientCapabilities.SshEnvironmentGateway, sshGateway),
        Layer.succeed(Connectivity.Connectivity, connectivity),
        Layer.succeed(
          ConnectionWakeups.ConnectionWakeups,
          ConnectionWakeups.ConnectionWakeups.of({ changes: Stream.never }),
        ),
        Layer.succeed(ConnectionDriver.ConnectionDriver, driver),
        layerCache,
        Layer.succeed(Persistence.EnvironmentOwnedDataCleanup, ownedDataCleanup),
      ),
    ),
  );

  return {
    layer,
    storedTargets,
    shellCache,
    cacheClears,
    ownedDataClears,
    sessions,
    releasedSessions,
    storedProfiles,
    profileReadCount,
    storedCredentials,
    storedDisabled,
    storedPlatformLabels,
    disconnectedSshTargets,
    networkStatus,
  };
});

function awaitConnectionState(
  registry: EnvironmentRegistry.EnvironmentRegistry["Service"],
  environmentId: EnvironmentId,
  predicate: (state: SupervisorConnectionState) => boolean,
) {
  return Effect.gen(function* () {
    const current = yield* registry.state(environmentId);
    if (predicate(current)) {
      return current;
    }
    return yield* registry
      .stateChanges(environmentId)
      .pipe(Stream.filter(predicate), Stream.runHead, Effect.map(Option.getOrThrow));
  });
}

describe("EnvironmentRegistry", () => {
  it.effect.each([
    { name: "direct", targets: [BEARER_TARGET], profiles: [BEARER_PROFILE], enabled: true },
    { name: "SSH", targets: [SSH_CONNECTION], profiles: [SSH_PROFILE], enabled: true },
    {
      name: "relay",
      targets: [BEARER_TARGET],
      profiles: [
        new BearerConnectionProfile({ ...BEARER_PROFILE, relayUrl: "wss://relay.example.test" }),
      ],
      enabled: false,
    },
  ] as const)(
    "persists a $name label without changing connection state or credentials",
    ({ targets, profiles, enabled }) =>
      Effect.gen(function* () {
        const environmentId = targets[0].environmentId;
        const disabledEnvironmentIds = enabled ? [] : [environmentId];
        const document = yield* Ref.make<ConnectionCatalogDocument>({
          ...EMPTY_CONNECTION_CATALOG_DOCUMENT,
          targets,
          profiles,
          disabledEnvironmentIds,
        });
        const harness = yield* makeHarness(
          targets,
          profiles,
          [[BEARER_TARGET.connectionId, BEARER_CREDENTIAL]],
          {
            initialDisabled: disabledEnvironmentIds,
            setRoutes: (id, nextTargets, nextProfiles) =>
              Ref.update(document, (current) =>
                setRoutesInCatalog(current, id, nextTargets, nextProfiles),
              ),
          },
        );
        yield* Effect.gen(function* () {
          const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
          yield* registry.start;
          const state = yield* awaitConnectionState(
            registry,
            environmentId,
            (state) => state.phase === (enabled ? "connected" : "available"),
          );
          const supervisor = yield* registry.run(
            environmentId,
            EnvironmentSupervisor.EnvironmentSupervisor,
          );
          const session = yield* SubscriptionRef.get(supervisor.session);
          const prepared = yield* SubscriptionRef.get(supervisor.prepared);
          const credentials = yield* Ref.get(harness.storedCredentials);

          yield* registry.rename(environmentId, "  Build Mac  ");

          const entry = (yield* SubscriptionRef.get(registry.entries)).get(environmentId)!;
          expect(entry.enabled).toBe(enabled);
          expect(connectionRoutes(entry).map((route) => route.target.label)).toEqual(
            targets.map(() => "Build Mac"),
          );
          expect(yield* registry.state(environmentId)).toEqual(state);
          expect(yield* SubscriptionRef.get(supervisor.session)).toEqual(session);
          expect(yield* SubscriptionRef.get(supervisor.prepared)).toBe(prepared);
          expect(yield* Ref.get(harness.storedCredentials)).toEqual(credentials);
          expect(yield* Ref.get(harness.releasedSessions)).toBe(0);
          expect(yield* Ref.get(harness.disconnectedSshTargets)).toEqual([]);
        }).pipe(Effect.provide(harness.layer), Effect.scoped);

        const jsonSchema = Schema.fromJsonString(ConnectionCatalogDocument);
        const encoded = yield* Schema.encodeEffect(jsonSchema)(yield* Ref.get(document));
        const persisted = yield* Schema.decodeEffect(jsonSchema)(encoded);
        expect(persisted.profiles).toEqual(
          profiles.map((profile) => expect.objectContaining({ ...profile, label: "Build Mac" })),
        );
        const reloaded = yield* makeHarness(persisted.targets, persisted.profiles, [], {
          initialDisabled: persisted.disabledEnvironmentIds,
        });
        yield* Effect.gen(function* () {
          const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
          const entry = (yield* SubscriptionRef.get(registry.entries)).get(environmentId)!;
          expect(entry.target.label).toBe("Build Mac");
          expect(entry.enabled).toBe(enabled);
        }).pipe(Effect.provide(reloaded.layer), Effect.scoped);
      }),
  );

  it.effect.each([
    {
      name: "primary",
      registration: new PrimaryConnectionRegistration({ target: TARGET }),
    },
    {
      name: "secondary local",
      registration: new BearerConnectionRegistration({
        target: BEARER_TARGET,
        profile: BEARER_PROFILE,
        credential: BEARER_CREDENTIAL,
      }),
    },
  ])("persists and resets a $name label without replacing its connection", ({ registration }) =>
    Effect.gen(function* () {
      const harness = yield* makeHarness([]);
      const environmentId = registration.target.environmentId;
      yield* Effect.gen(function* () {
        const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
        yield* registry.reconcilePlatform([registration]);
        yield* awaitConnectionState(
          registry,
          environmentId,
          (state) => state.phase === "connected",
        );
        const state = yield* registry.state(environmentId);
        yield* registry.rename(environmentId, "  My workstation  ");
        yield* registry.reconcilePlatform([registration]);
        expect((yield* SubscriptionRef.get(registry.entries)).get(environmentId)).toMatchObject({
          target: { ...registration.target, label: "My workstation" },
          defaultLabel: registration.target.label,
        });
        expect(yield* registry.state(environmentId)).toEqual(state);
        expect(yield* Ref.get(harness.releasedSessions)).toBe(0);
        expect(yield* Ref.get(harness.sessions)).toHaveLength(1);
        expect(yield* Ref.get(harness.storedTargets)).toEqual(new Map());
      }).pipe(Effect.provide(harness.layer), Effect.scoped);

      const persisted = yield* decodeConnectionCatalogDocument({
        ...EMPTY_CONNECTION_CATALOG_DOCUMENT,
        platformLabels: yield* Ref.get(harness.storedPlatformLabels),
      });
      const reloaded = yield* makeHarness([], [], [], {
        initialPlatformLabels: persisted.platformLabels,
      });
      yield* Effect.gen(function* () {
        const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
        yield* registry.reconcilePlatform([registration]);
        yield* awaitConnectionState(
          registry,
          environmentId,
          (state) => state.phase === "connected",
        );
        expect(
          (yield* SubscriptionRef.get(registry.entries)).get(environmentId)?.target.label,
        ).toBe("My workstation");
        const state = yield* registry.state(environmentId);
        const detectedLabel = "New computer name";
        const renamedRegistration =
          registration._tag === "PrimaryConnectionRegistration"
            ? new PrimaryConnectionRegistration({
                target: new PrimaryConnectionTarget({
                  ...registration.target,
                  label: detectedLabel,
                }),
              })
            : new BearerConnectionRegistration({
                ...registration,
                target: new BearerConnectionTarget({
                  ...registration.target,
                  label: detectedLabel,
                }),
                profile: new BearerConnectionProfile({
                  ...registration.profile,
                  label: detectedLabel,
                }),
              });
        yield* registry.reconcilePlatform([renamedRegistration]);
        expect((yield* SubscriptionRef.get(registry.entries)).get(environmentId)).toMatchObject({
          target: { label: "My workstation" },
          defaultLabel: detectedLabel,
        });
        expect(yield* registry.state(environmentId)).toEqual(state);
        expect(yield* Ref.get(reloaded.releasedSessions)).toBe(0);
        expect(yield* Ref.get(reloaded.sessions)).toHaveLength(1);
        yield* registry.rename(environmentId, null);
        expect(
          (yield* SubscriptionRef.get(registry.entries)).get(environmentId)?.target.label,
        ).toBe(detectedLabel);
        expect(yield* registry.state(environmentId)).toEqual(state);
        expect(yield* Ref.get(reloaded.storedPlatformLabels)).toEqual([]);
        yield* registry.reconcilePlatform([renamedRegistration]);
        expect(
          (yield* SubscriptionRef.get(registry.entries)).get(environmentId)?.target.label,
        ).toBe(detectedLabel);
      }).pipe(Effect.provide(reloaded.layer), Effect.scoped);
    }),
  );

  it.effect("keeps the current local label when saving or resetting fails", () =>
    Effect.gen(function* () {
      const failure = new Persistence.ConnectionPersistenceError({
        operation: "set-platform-label",
        message: "Storage unavailable",
      });
      const harness = yield* makeHarness([], [], [], {
        initialPlatformLabels: [{ environmentId: TARGET.environmentId, label: "My workstation" }],
        setPlatformLabel: () => Effect.fail(failure),
      });
      yield* Effect.gen(function* () {
        const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
        yield* registry.registerPlatform(new PrimaryConnectionRegistration({ target: TARGET }));
        const before = yield* SubscriptionRef.get(registry.entries);
        for (const label of ["Build Mac", null]) {
          expect(yield* Effect.flip(registry.rename(TARGET.environmentId, label))).toBe(failure);
          expect(yield* SubscriptionRef.get(registry.entries)).toBe(before);
        }
        yield* registry.registerPlatform(new PrimaryConnectionRegistration({ target: TARGET }));
        expect(
          (yield* SubscriptionRef.get(registry.entries)).get(TARGET.environmentId)?.target.label,
        ).toBe("My workstation");
      }).pipe(Effect.provide(harness.layer), Effect.scoped);
    }),
  );

  it.effect("keeps automatic naming when saving the detected name", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness([]);
      yield* Effect.gen(function* () {
        const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
        yield* registry.registerPlatform(new PrimaryConnectionRegistration({ target: TARGET }));
        yield* registry.rename(TARGET.environmentId, TARGET.label);
        expect(yield* Ref.get(harness.storedPlatformLabels)).toEqual([]);
        yield* registry.rename(TARGET.environmentId, "My workstation");
        const renamedTarget = new PrimaryConnectionTarget({
          ...TARGET,
          label: "New computer name",
        });
        const renamedRegistration = new PrimaryConnectionRegistration({ target: renamedTarget });
        yield* registry.registerPlatform(renamedRegistration);
        expect(
          (yield* SubscriptionRef.get(registry.entries)).get(TARGET.environmentId)?.target.label,
        ).toBe("My workstation");
        yield* registry.rename(TARGET.environmentId, renamedTarget.label);
        expect(yield* Ref.get(harness.storedPlatformLabels)).toEqual([]);
        yield* registry.registerPlatform(new PrimaryConnectionRegistration({ target: TARGET }));
        expect(
          (yield* SubscriptionRef.get(registry.entries)).get(TARGET.environmentId)?.target.label,
        ).toBe(TARGET.label);
      }).pipe(Effect.provide(harness.layer), Effect.scoped);
    }),
  );

  it.effect("keeps the current label when saving fails and rejects blank labels", () =>
    Effect.gen(function* () {
      const failure = new Persistence.ConnectionPersistenceError({
        operation: "set-connection-routes",
        message: "Storage unavailable",
      });
      const harness = yield* makeHarness(
        [BEARER_TARGET],
        [BEARER_PROFILE],
        [[BEARER_TARGET.connectionId, BEARER_CREDENTIAL]],
        { setRoutes: () => Effect.fail(failure) },
      );
      yield* Effect.gen(function* () {
        const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
        const before = yield* SubscriptionRef.get(registry.entries);
        expect(yield* Effect.flip(registry.rename(BEARER_TARGET.environmentId, "Build Mac"))).toBe(
          failure,
        );
        expect(yield* SubscriptionRef.get(registry.entries)).toBe(before);
        expect(
          yield* Effect.flip(registry.rename(BEARER_TARGET.environmentId, "  ")),
        ).toMatchObject({
          _tag: "ConnectionBlockedError",
          detail: "Environment label cannot be empty.",
        });
        expect(
          yield* Effect.flip(registry.rename(BEARER_TARGET.environmentId, null)),
        ).toMatchObject({
          _tag: "ConnectionBlockedError",
          detail: "Only local environments can reset their label.",
        });
      }).pipe(Effect.provide(harness.layer), Effect.scoped);
    }),
  );

  it.effect(
    "keeps the session and durable subscription when renaming, reordering or removing an unused route",
    () =>
      Effect.gen(function* () {
        const alternateTarget = new BearerConnectionTarget({
          ...BEARER_TARGET,
          connectionId: "alternate",
        });
        const alternateProfile = new BearerConnectionProfile({
          ...BEARER_PROFILE,
          connectionId: alternateTarget.connectionId,
          httpBaseUrl: "https://alternate.example.test/",
          wsBaseUrl: "wss://alternate.example.test/",
        });
        const harness = yield* makeHarness(
          [BEARER_TARGET],
          [BEARER_PROFILE],
          [[BEARER_TARGET.connectionId, BEARER_CREDENTIAL]],
        );
        yield* Effect.gen(function* () {
          const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
          yield* registry.start;
          yield* awaitConnectionState(
            registry,
            BEARER_TARGET.environmentId,
            (state) => state.phase === "connected",
          );
          yield* registry.register(
            new BearerConnectionRegistration({
              target: alternateTarget,
              profile: alternateProfile,
              credential: BEARER_CREDENTIAL,
            }),
          );
          const originalState = yield* awaitConnectionState(
            registry,
            BEARER_TARGET.environmentId,
            (state) => state.phase === "connected",
          );
          const originalSupervisor = yield* registry.run(
            BEARER_TARGET.environmentId,
            EnvironmentSupervisor.EnvironmentSupervisor,
          );
          const originalSession = yield* SubscriptionRef.get(originalSupervisor.session);
          const starts = yield* Ref.make(0);
          const subscribed = yield* Deferred.make<void>();
          const subscription = yield* registry
            .followStream(
              BEARER_TARGET.environmentId,
              Stream.fromEffect(
                Ref.update(starts, (count) => count + 1).pipe(
                  Effect.andThen(Deferred.succeed(subscribed, undefined)),
                ),
              ).pipe(Stream.concat(Stream.never)),
            )
            .pipe(Stream.runDrain, Effect.forkChild);
          yield* Deferred.await(subscribed);

          yield* registry.rename(BEARER_TARGET.environmentId, "Build Mac");
          const renamed = (yield* SubscriptionRef.get(registry.entries)).get(
            BEARER_TARGET.environmentId,
          )!;
          expect(connectionRoutes(renamed).map((route) => route.target.label)).toEqual([
            "Build Mac",
            "Build Mac",
          ]);
          expect(
            connectionRoutes(renamed).map((route) => Option.getOrThrow(route.profile).label),
          ).toEqual(["Build Mac", "Build Mac"]);

          yield* registry.reorderRoutes(BEARER_TARGET.environmentId, [
            alternateTarget.connectionId,
            BEARER_TARGET.connectionId,
          ]);
          yield* Effect.yieldNow;
          expect(yield* Ref.get(starts)).toBe(1);
          expect(yield* registry.state(BEARER_TARGET.environmentId)).toEqual(originalState);
          expect(yield* SubscriptionRef.get(originalSupervisor.session)).toEqual(originalSession);
          expect(
            yield* registry.run(
              BEARER_TARGET.environmentId,
              EnvironmentSupervisor.EnvironmentSupervisor,
            ),
          ).toBe(originalSupervisor);

          yield* registry.removeRoute(BEARER_TARGET.environmentId, alternateTarget.connectionId);
          yield* Effect.yieldNow;
          expect(yield* Ref.get(starts)).toBe(1);
          expect(yield* registry.state(BEARER_TARGET.environmentId)).toEqual(originalState);
          expect(yield* SubscriptionRef.get(originalSupervisor.session)).toEqual(originalSession);
          expect((yield* Ref.get(harness.sessions)).length).toBe(2);
          expect(yield* Ref.get(harness.releasedSessions)).toBe(1);
          yield* Fiber.interrupt(subscription);
        }).pipe(Effect.provide(harness.layer), Effect.scoped);
      }),
  );

  it.effect("reconnects through a remaining route after the active route is removed", () =>
    Effect.gen(function* () {
      const alternateTarget = new BearerConnectionTarget({
        ...BEARER_TARGET,
        connectionId: "alternate",
      });
      const harness = yield* makeHarness(
        [BEARER_TARGET],
        [BEARER_PROFILE],
        [[BEARER_TARGET.connectionId, BEARER_CREDENTIAL]],
      );
      yield* Effect.gen(function* () {
        const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
        yield* registry.start;
        yield* awaitConnectionState(
          registry,
          BEARER_TARGET.environmentId,
          (state) => state.phase === "connected",
        );
        yield* registry.register(
          new BearerConnectionRegistration({
            target: alternateTarget,
            profile: new BearerConnectionProfile({
              ...BEARER_PROFILE,
              connectionId: alternateTarget.connectionId,
              httpBaseUrl: "https://alternate.example.test/",
              wsBaseUrl: "wss://alternate.example.test/",
            }),
            credential: BEARER_CREDENTIAL,
          }),
        );
        yield* awaitConnectionState(
          registry,
          BEARER_TARGET.environmentId,
          (state) => state.phase === "connected",
        );
        yield* registry.removeRoute(BEARER_TARGET.environmentId, BEARER_TARGET.connectionId);
        yield* awaitConnectionState(
          registry,
          BEARER_TARGET.environmentId,
          (state) => state.phase === "connected",
        );
        const prepared = yield* registry.run(
          BEARER_TARGET.environmentId,
          EnvironmentSupervisor.EnvironmentSupervisor.pipe(
            Effect.flatMap((supervisor) => SubscriptionRef.get(supervisor.prepared)),
          ),
        );
        expect(Option.getOrThrow(prepared).target).toEqual(alternateTarget);
        expect((yield* Ref.get(harness.sessions)).length).toBe(3);
        expect(yield* Ref.get(harness.releasedSessions)).toBe(2);
      }).pipe(Effect.provide(harness.layer), Effect.scoped);
    }),
  );

  it.effect("restarts pending socket setup when an unused route is removed", () =>
    Effect.gen(function* () {
      const holdNext = yield* Ref.make(false);
      const opening = yield* Deferred.make<void>();
      const cancelled = yield* Deferred.make<void>();
      const harness = yield* makeHarness(
        [BEARER_TARGET],
        [BEARER_PROFILE],
        [[BEARER_TARGET.connectionId, BEARER_CREDENTIAL]],
        {
          beforeSessionConnect: () =>
            Ref.getAndSet(holdNext, false).pipe(
              Effect.flatMap((hold) =>
                hold
                  ? Deferred.succeed(opening, undefined).pipe(
                      Effect.andThen(Effect.never),
                      Effect.onInterrupt(() => Deferred.succeed(cancelled, undefined)),
                    )
                  : Effect.void,
              ),
            ),
        },
      );
      yield* Effect.gen(function* () {
        const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
        yield* registry.start;
        yield* awaitConnectionState(
          registry,
          BEARER_TARGET.environmentId,
          (state) => state.phase === "connected",
        );
        yield* Ref.set(holdNext, true);
        const alternateTarget = new BearerConnectionTarget({
          ...BEARER_TARGET,
          connectionId: "alternate",
        });
        yield* registry.register(
          new BearerConnectionRegistration({
            target: alternateTarget,
            profile: new BearerConnectionProfile({
              ...BEARER_PROFILE,
              connectionId: alternateTarget.connectionId,
              httpBaseUrl: "https://alternate.example.test/",
              wsBaseUrl: "wss://alternate.example.test/",
            }),
            credential: BEARER_CREDENTIAL,
          }),
        );
        yield* Deferred.await(opening);
        yield* registry.removeRoute(BEARER_TARGET.environmentId, alternateTarget.connectionId);
        expect(yield* Deferred.isDone(cancelled)).toBe(true);
        yield* awaitConnectionState(
          registry,
          BEARER_TARGET.environmentId,
          (state) => state.phase === "connected",
        );
        const prepared = yield* registry.run(
          BEARER_TARGET.environmentId,
          EnvironmentSupervisor.EnvironmentSupervisor.pipe(
            Effect.flatMap((supervisor) => SubscriptionRef.get(supervisor.prepared)),
          ),
        );
        expect(Option.getOrThrow(prepared).target).toEqual(BEARER_TARGET);
        expect((yield* Ref.get(harness.sessions)).length).toBe(2);
      }).pipe(Effect.provide(harness.layer), Effect.scoped);
    }),
  );

  it.effect("replays connected state when arming a desktop commit observer", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness([TARGET]);

      yield* Effect.gen(function* () {
        const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
        yield* registry.start;
        yield* awaitConnectionState(
          registry,
          TARGET.environmentId,
          (state) => state.phase === "connected",
        );

        const commits = yield* Ref.make(0);
        const result = yield* runDesktopCommitWithReconnectObserver(
          registry.stateChanges(TARGET.environmentId),
          Ref.update(commits, (count) => count + 1).pipe(
            Effect.andThen(Effect.fail("commit refused")),
          ),
        ).pipe(Effect.flip, Effect.timeout("1 second"));

        expect(result).toBe("commit refused");
        expect(yield* Ref.get(commits)).toBe(1);
      }).pipe(Effect.provide(harness.layer), Effect.scoped);
    }),
  );

  it.effect("does not acquire a session after the registry scope has already closed", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness([TARGET]);
      const registryScope = yield* Scope.make();
      const context = yield* Layer.build(harness.layer).pipe(Scope.provide(registryScope));
      const registry = Context.get(context, EnvironmentRegistry.EnvironmentRegistry);
      const dispatcher = new Scheduler.MixedScheduler("sync", () => () => {}).makeDispatcher();
      const scheduler: Scheduler.Scheduler = {
        executionMode: "sync",
        shouldYield: () => false,
        makeDispatcher: () => dispatcher,
      };

      yield* Scope.close(registryScope, Exit.void);
      yield* registry.start.pipe(Effect.provideService(Scheduler.Scheduler, scheduler));
      dispatcher.flush();

      expect(yield* Ref.get(harness.sessions)).toHaveLength(0);
      expect(yield* Ref.get(harness.releasedSessions)).toBe(0);
    }),
  );

  it.effect("starts persisted environments independently", () =>
    Effect.gen(function* () {
      const bothLoadsStarted = yield* Deferred.make<void>();
      const releaseLoads = yield* Deferred.make<void>();
      const loadCount = yield* Ref.make(0);
      const harness = yield* makeHarness([TARGET, SECOND_TARGET], [], [], {
        beforeSessionConnect: () =>
          Ref.updateAndGet(loadCount, (count) => count + 1).pipe(
            Effect.tap((count) =>
              count === 2 ? Deferred.succeed(bothLoadsStarted, undefined) : Effect.void,
            ),
            Effect.andThen(Deferred.await(releaseLoads)),
          ),
      });

      yield* Effect.gen(function* () {
        const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
        const start = yield* Effect.forkChild(registry.start);

        yield* Deferred.await(bothLoadsStarted).pipe(Effect.timeout("1 second"));
        yield* Deferred.succeed(releaseLoads, undefined);
        yield* Fiber.join(start);

        expect(yield* Ref.get(loadCount)).toBe(2);
      }).pipe(Effect.provide(harness.layer), Effect.scoped);
    }),
  );

  it.effect("does not expose a persisted environment as disconnected while it starts", () =>
    Effect.gen(function* () {
      const connectionStarted = yield* Deferred.make<void>();
      const finishConnection = yield* Deferred.make<void>();
      const harness = yield* makeHarness([TARGET], [], [], {
        beforeSessionConnect: () =>
          Deferred.succeed(connectionStarted, undefined).pipe(
            Effect.andThen(Deferred.await(finishConnection)),
          ),
      });

      yield* Effect.gen(function* () {
        const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
        expect((yield* registry.state(TARGET.environmentId)).phase).toBe("connecting");

        yield* Deferred.await(connectionStarted);
        expect((yield* registry.state(TARGET.environmentId)).phase).toBe("connecting");
        yield* Deferred.succeed(finishConnection, undefined);
      }).pipe(Effect.provide(harness.layer), Effect.scoped);
    }),
  );

  it.effect("preserves cached data on connection failure and clears it on explicit removal", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness([TARGET]);
      yield* Effect.gen(function* () {
        const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
        yield* registry.start;
        yield* awaitConnectionState(
          registry,
          TARGET.environmentId,
          (state) => state.phase === "connected",
        );
        const controls = yield* Ref.get(harness.sessions);
        expect(controls).toHaveLength(1);
        const active = controls[0];
        expect(active).toBeDefined();
        expect((yield* Ref.get(harness.shellCache)).get(TARGET.environmentId)).toEqual(
          CACHED_SNAPSHOT,
        );

        const retryFiber = yield* Effect.forkChild(
          awaitConnectionState(
            registry,
            TARGET.environmentId,
            (state) => state.phase === "backoff",
          ),
        );
        yield* Effect.yieldNow;
        yield* Deferred.fail(
          active!.closed,
          new ConnectionTransientError({
            reason: "transport",
            detail: "Disconnected.",
          }),
        );
        yield* Fiber.join(retryFiber);
        expect((yield* Ref.get(harness.shellCache)).get(TARGET.environmentId)).toEqual(
          CACHED_SNAPSHOT,
        );

        yield* registry.remove(TARGET.environmentId);
        expect((yield* Ref.get(harness.storedTargets)).has(TARGET.environmentId)).toBe(false);
        expect((yield* Ref.get(harness.shellCache)).has(TARGET.environmentId)).toBe(false);
        expect(yield* Ref.get(harness.cacheClears)).toEqual([TARGET.environmentId]);
        expect((yield* SubscriptionRef.get(registry.entries)).has(TARGET.environmentId)).toBe(
          false,
        );
      }).pipe(Effect.provide(harness.layer));
    }),
  );

  it.effect("keeps unsupported learned routes off until compatibility changes", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness(
        [REMOTE_TARGET],
        [new BearerConnectionProfile({ ...remoteProfile(REMOTE_TARGET), learned: true })],
        [],
        {
          initialDisabled: [REMOTE_TARGET.environmentId],
        },
      );
      yield* Effect.gen(function* () {
        const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
        yield* registry.start;
        const error = new ConnectionBlockedError({
          reason: "unsupported",
          detail: "Use a compatible client.",
        });
        yield* registry.setCompatibility(REMOTE_TARGET.environmentId, error);
        const entry = (yield* SubscriptionRef.get(registry.entries)).get(
          REMOTE_TARGET.environmentId,
        );
        expect(entry).toMatchObject({ enabled: false, unsupportedReason: error.message });
        expect(
          yield* Effect.flip(registry.setEnabled(REMOTE_TARGET.environmentId, true)),
        ).toMatchObject({ reason: "unsupported" });
        expect(yield* Ref.get(harness.sessions)).toHaveLength(0);
        yield* registry.setCompatibility(REMOTE_TARGET.environmentId, null);
        expect(
          (yield* SubscriptionRef.get(registry.entries)).get(REMOTE_TARGET.environmentId)?.enabled,
        ).toBe(false);
        expect(yield* registry.state(REMOTE_TARGET.environmentId)).toMatchObject({
          desired: false,
        });
        expect(yield* Ref.get(harness.storedDisabled)).toEqual(
          new Set([REMOTE_TARGET.environmentId]),
        );
        expect(yield* Ref.get(harness.sessions)).toHaveLength(0);
        yield* registry.setEnabled(REMOTE_TARGET.environmentId, true);
        yield* awaitConnectionState(
          registry,
          REMOTE_TARGET.environmentId,
          (state) => state.phase === "connected",
        );
      }).pipe(Effect.provide(harness.layer));
    }),
  );

  it.effect("protocol rejection preserves enablement through recovery and relaunch", () =>
    Effect.gen(function* () {
      const error = new ConnectionBlockedError({
        reason: "unsupported",
        detail: "Use a compatible client.",
      });
      const rejection = yield* Ref.make<ConnectionBlockedError | undefined>(error);
      const harness = yield* makeHarness([REMOTE_TARGET], [], [], {
        beforePrepareRoute: () => Ref.get(rejection),
      });
      yield* Effect.gen(function* () {
        const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
        yield* registry.start;
        yield* SubscriptionRef.changes(registry.entries).pipe(
          Stream.filter(
            (entries) => entries.get(REMOTE_TARGET.environmentId)?.unsupportedReason !== undefined,
          ),
          Stream.take(1),
          Stream.runDrain,
        );
        expect(yield* Ref.get(harness.storedDisabled)).toEqual(new Set());
        expect(
          (yield* SubscriptionRef.get(registry.entries)).get(REMOTE_TARGET.environmentId),
        ).toMatchObject({ enabled: true, unsupportedReason: error.message });
        yield* awaitConnectionState(
          registry,
          REMOTE_TARGET.environmentId,
          (state) => !state.desired && state.phase === "available",
        );
        expect(yield* Ref.get(harness.sessions)).toHaveLength(0);

        yield* Ref.set(rejection, undefined);
        yield* registry.setCompatibility(REMOTE_TARGET.environmentId, null);
        yield* awaitConnectionState(
          registry,
          REMOTE_TARGET.environmentId,
          (state) => state.phase === "connected",
        );
        expect(yield* Ref.get(harness.sessions)).toHaveLength(1);
        yield* registry.setCompatibility(REMOTE_TARGET.environmentId, error);
        yield* awaitConnectionState(
          registry,
          REMOTE_TARGET.environmentId,
          (state) => !state.desired && state.phase === "available",
        );
        expect(yield* Ref.get(harness.releasedSessions)).toBe(1);
      }).pipe(Effect.provide(harness.layer), Effect.scoped);

      yield* Effect.gen(function* () {
        const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
        const entry = (yield* SubscriptionRef.get(registry.entries)).get(
          REMOTE_TARGET.environmentId,
        );
        expect(entry?.enabled).toBe(true);
        expect(entry?.unsupportedReason).toBeUndefined();
        yield* registry.start;
        yield* awaitConnectionState(
          registry,
          REMOTE_TARGET.environmentId,
          (state) => state.phase === "connected",
        );
      }).pipe(Effect.provide(harness.layer), Effect.scoped);
    }),
  );

  it.effect("removes and disables environments while companion teardown is pending", () =>
    Effect.gen(function* () {
      for (const action of ["disable", "remove"] as const) {
        const harness = yield* makeHarness([BEARER_TARGET], [BEARER_PROFILE]);
        let finishClose!: () => void;
        const closed = new Promise<void>((resolve) => {
          finishClose = resolve;
        });
        const released: string[] = [];
        yield* Effect.gen(function* () {
          const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
          yield* action === "disable"
            ? registry.setEnabled(BEARER_TARGET.environmentId, false)
            : registry.remove(BEARER_TARGET.environmentId);
          expect(released).toEqual([BEARER_PROFILE.httpBaseUrl]);
          const entry = (yield* SubscriptionRef.get(registry.entries)).get(
            BEARER_TARGET.environmentId,
          );
          expect(action === "disable" ? entry?.enabled : entry).toBe(
            action === "disable" ? false : undefined,
          );
          finishClose();
        }).pipe(
          Effect.provide(harness.layer),
          Effect.provideService(
            RelayGateway,
            RelayGateway.of({
              available: true,
              via: () => undefined,
              subscribe: () => () => {},
              lease: () => {
                throw new Error("Unexpected pairing lease");
              },
              resolve: async (address) => address,
              fetch,
              release: async (address) => {
                released.push(address);
                await closed;
              },
            }),
          ),
          Effect.ensuring(Effect.sync(finishClose)),
        );
      }
    }),
  );

  it.effect.each([
    { outcome: "connects after a server update", compatible: true, relayFirst: false },
    { outcome: "connects with a preferred relay route", compatible: true, relayFirst: true },
    { outcome: "blocks again if still incompatible", compatible: false, relayFirst: false },
  ])("retrying an unsupported saved URL $outcome", ({ compatible, relayFirst }) =>
    Effect.gen(function* () {
      const environmentId = BEARER_TARGET.environmentId;
      const error = new ConnectionBlockedError({
        reason: "unsupported",
        detail: "Update the server to use this client.",
        serverUpdateRequired: true,
      });
      const profile = new BearerConnectionProfile({
        ...BEARER_PROFILE,
        ...(relayFirst ? { relayUrl: "wss://relay.example.test" } : {}),
      });
      const attempts = yield* Ref.make(0);
      const retryStarted = yield* Deferred.make<void>();
      const retryResult = yield* Deferred.make<ConnectionBlockedError | undefined>();
      const harness = yield* makeHarness(
        [BEARER_TARGET],
        [profile],
        [[BEARER_TARGET.connectionId, BEARER_CREDENTIAL]],
        {
          beforePrepareRoute: () =>
            Effect.gen(function* () {
              if ((yield* Ref.updateAndGet(attempts, (count) => count + 1)) === 1) return error;
              yield* Deferred.succeed(retryStarted, undefined);
              return yield* Deferred.await(retryResult);
            }),
        },
      );
      yield* Effect.gen(function* () {
        const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
        yield* registry.start;
        const awaitUnsupported = SubscriptionRef.changes(registry.entries).pipe(
          Stream.filter((entries) => entries.get(environmentId)?.unsupportedReason !== undefined),
          Stream.take(1),
          Stream.runDrain,
        );
        yield* awaitUnsupported;
        expect((yield* Ref.get(harness.storedDisabled)).has(environmentId)).toBe(false);
        expect((yield* SubscriptionRef.get(registry.entries)).get(environmentId)).toMatchObject({
          target: BEARER_TARGET,
          enabled: true,
          unsupportedReason: error.message,
          serverUpdateRequired: true,
        });
        expect(yield* Ref.get(attempts)).toBe(1);

        yield* registry.setEnabled(environmentId, true);
        yield* Deferred.await(retryStarted);
        const retrying = (yield* SubscriptionRef.get(registry.entries)).get(environmentId);
        expect(retrying?.enabled).toBe(true);
        expect(retrying?.unsupportedReason).toBeUndefined();
        expect(retrying?.serverUpdateRequired).toBeUndefined();
        expect((yield* Ref.get(harness.storedDisabled)).has(environmentId)).toBe(false);

        yield* Deferred.succeed(retryResult, compatible ? undefined : error);
        if (compatible) {
          yield* awaitConnectionState(
            registry,
            environmentId,
            (state) => state.phase === "connected",
          );
          expect(yield* Ref.get(harness.sessions)).toHaveLength(1);
        } else {
          yield* awaitUnsupported;
          expect((yield* SubscriptionRef.get(registry.entries)).get(environmentId)).toMatchObject({
            enabled: true,
            unsupportedReason: error.message,
            serverUpdateRequired: true,
          });
          expect((yield* Ref.get(harness.storedDisabled)).has(environmentId)).toBe(false);
          expect(yield* Ref.get(harness.sessions)).toHaveLength(0);
        }
        expect(yield* Ref.get(attempts)).toBe(2);
      }).pipe(Effect.provide(harness.layer));
    }),
  );

  it.effect("switching an environment off disconnects it and persists the flag", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness([REMOTE_TARGET]);

      yield* Effect.gen(function* () {
        const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
        yield* registry.start;
        yield* awaitConnectionState(
          registry,
          REMOTE_TARGET.environmentId,
          (state) => state.phase === "connected",
        );

        yield* registry.setEnabled(REMOTE_TARGET.environmentId, false);
        yield* awaitConnectionState(
          registry,
          REMOTE_TARGET.environmentId,
          (state) => state.phase === "available",
        );

        const entry = (yield* SubscriptionRef.get(registry.entries)).get(
          REMOTE_TARGET.environmentId,
        );
        expect(entry?.enabled).toBe(false);
        expect((yield* Ref.get(harness.storedDisabled)).has(REMOTE_TARGET.environmentId)).toBe(
          true,
        );
        expect((yield* Ref.get(harness.storedTargets)).has(REMOTE_TARGET.environmentId)).toBe(true);
        expect(yield* Ref.get(harness.releasedSessions)).toBe(1);

        yield* registry.setEnabled(REMOTE_TARGET.environmentId, true);
        yield* awaitConnectionState(
          registry,
          REMOTE_TARGET.environmentId,
          (state) => state.phase === "connected",
        );
        expect((yield* Ref.get(harness.storedDisabled)).has(REMOTE_TARGET.environmentId)).toBe(
          false,
        );
      }).pipe(Effect.provide(harness.layer));
    }),
  );

  it.effect("re-registering a switched-off environment keeps it off", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness([REMOTE_TARGET], [], [], {
        initialDisabled: [REMOTE_TARGET.environmentId],
      });

      yield* Effect.gen(function* () {
        const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
        yield* registry.start;
        yield* registry.register(
          remoteRegistration(new BearerConnectionTarget({ ...REMOTE_TARGET, label: "Renamed" })),
        );
        yield* Effect.yieldNow;

        const entry = (yield* SubscriptionRef.get(registry.entries)).get(
          REMOTE_TARGET.environmentId,
        );
        expect(entry?.target.label).toBe("Renamed");
        expect(entry?.enabled).toBe(false);
        expect(yield* Ref.get(harness.sessions)).toHaveLength(0);
      }).pipe(Effect.provide(harness.layer));
    }),
  );

  it.effect("switching an SSH environment off tears down its managed backend", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness([SSH_CONNECTION], [SSH_PROFILE]);

      yield* Effect.gen(function* () {
        const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
        yield* registry.start;
        yield* awaitConnectionState(
          registry,
          SSH_CONNECTION.environmentId,
          (state) => state.phase === "connected",
        );

        yield* registry.setEnabled(SSH_CONNECTION.environmentId, false);
        yield* awaitConnectionState(
          registry,
          SSH_CONNECTION.environmentId,
          (state) => state.phase === "available",
        );

        expect(yield* Ref.get(harness.disconnectedSshTargets)).toEqual([SSH_TARGET]);
        expect((yield* Ref.get(harness.storedTargets)).has(SSH_CONNECTION.environmentId)).toBe(
          true,
        );
      }).pipe(Effect.provide(harness.layer));
    }),
  );

  it.effect("moves durable streams to a replacement supervisor", () =>
    Effect.gen(function* () {
      const replacement = new BearerConnectionTarget({
        ...REMOTE_TARGET,
        label: "Replacement remote environment",
      });
      const harness = yield* makeHarness([REMOTE_TARGET]);

      yield* Effect.gen(function* () {
        const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
        const firstObserved = yield* Deferred.make<void>();
        const secondObserved = yield* Deferred.make<void>();
        const labels = yield* Ref.make<ReadonlyArray<string>>([]);
        yield* registry.start;
        yield* awaitConnectionState(
          registry,
          REMOTE_TARGET.environmentId,
          (state) => state.phase === "connected",
        );

        const subscription = yield* Effect.forkChild(
          registry
            .followStream(
              REMOTE_TARGET.environmentId,
              Stream.unwrap(
                EnvironmentSupervisor.EnvironmentSupervisor.pipe(
                  Effect.map((supervisor) =>
                    Stream.concat(Stream.succeed(supervisor.target.label), Stream.never),
                  ),
                ),
              ),
            )
            .pipe(
              Stream.tap((label) =>
                Ref.updateAndGet(labels, (current) => [...current, label]).pipe(
                  Effect.flatMap((current) =>
                    current.length === 1
                      ? Deferred.succeed(firstObserved, undefined)
                      : Deferred.succeed(secondObserved, undefined),
                  ),
                ),
              ),
              Stream.runDrain,
            ),
        );

        yield* Deferred.await(firstObserved).pipe(Effect.timeout("1 second"));
        yield* registry.register(remoteRegistration(replacement));
        yield* Deferred.await(secondObserved).pipe(Effect.timeout("1 second"));
        yield* Fiber.interrupt(subscription);

        expect(yield* Ref.get(labels)).toEqual([REMOTE_TARGET.label, replacement.label]);
      }).pipe(Effect.provide(harness.layer), Effect.scoped);
    }),
  );

  it.effect("moves prepared credential observers when re-pairing an unchanged environment", () =>
    Effect.gen(function* () {
      const replacementCredential = new BearerConnectionCredential({ token: "replacement-token" });
      const harness = yield* makeHarness(
        [BEARER_TARGET],
        [BEARER_PROFILE],
        [[BEARER_TARGET.connectionId, BEARER_CREDENTIAL]],
      );

      yield* Effect.gen(function* () {
        const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
        const initialObserved = yield* Deferred.make<void>();
        const replacementObserved = yield* Deferred.make<void>();
        const tokens = yield* Ref.make<ReadonlyArray<string>>([]);
        const followedSupervisors = yield* Ref.make(0);
        yield* registry.start;

        const subscription = yield* Effect.forkChild(
          registry
            .followStream(
              BEARER_TARGET.environmentId,
              Stream.unwrap(
                Effect.gen(function* () {
                  const supervisor = yield* EnvironmentSupervisor.EnvironmentSupervisor;
                  yield* Ref.update(followedSupervisors, (count) => count + 1);
                  return SubscriptionRef.changes(supervisor.prepared);
                }),
              ),
            )
            .pipe(
              Stream.filterMap((prepared) =>
                Option.isSome(prepared) && prepared.value.httpAuthorization?._tag === "Bearer"
                  ? Result.succeed(prepared.value.httpAuthorization.token)
                  : Result.failVoid,
              ),
              Stream.changes,
              Stream.runForEach((token) =>
                Effect.gen(function* () {
                  yield* Ref.update(tokens, (current) => [...current, token]);
                  yield* Deferred.succeed(
                    token === replacementCredential.token ? replacementObserved : initialObserved,
                    undefined,
                  );
                }),
              ),
            ),
        );

        yield* Deferred.await(initialObserved);
        yield* registry.register(
          new BearerConnectionRegistration({
            target: new BearerConnectionTarget({ ...BEARER_TARGET }),
            profile: new BearerConnectionProfile({ ...BEARER_PROFILE }),
            credential: replacementCredential,
          }),
        );
        yield* Deferred.await(replacementObserved);
        yield* Fiber.interrupt(subscription);

        expect(yield* Ref.get(tokens)).toEqual([
          BEARER_CREDENTIAL.token,
          replacementCredential.token,
        ]);
        expect(yield* Ref.get(followedSupervisors)).toBe(2);
      }).pipe(Effect.provide(harness.layer), Effect.scoped);
    }),
  );

  it.effect("keeps the runtime registered when durable removal fails", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness([REMOTE_TARGET], [], [], {
        beforeRegistrationRemove: () =>
          Effect.fail(
            new Persistence.ConnectionPersistenceError({
              operation: "remove-connection",
              message: "Storage is unavailable.",
            }),
          ),
      });

      yield* Effect.gen(function* () {
        const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
        yield* registry.start;
        yield* awaitConnectionState(
          registry,
          REMOTE_TARGET.environmentId,
          (state) => state.phase === "connected",
        );

        const error = yield* Effect.flip(registry.remove(REMOTE_TARGET.environmentId));

        expect(error._tag).toBe("ConnectionPersistenceError");
        expect(yield* Ref.get(harness.releasedSessions)).toBe(0);
        expect(
          (yield* SubscriptionRef.get(registry.entries)).has(REMOTE_TARGET.environmentId),
        ).toBe(true);
        expect((yield* Ref.get(harness.storedTargets)).has(REMOTE_TARGET.environmentId)).toBe(true);
        expect(yield* Ref.get(harness.cacheClears)).toEqual([]);
        expect(yield* Ref.get(harness.ownedDataClears)).toEqual([]);
      }).pipe(Effect.provide(harness.layer), Effect.scoped);
    }),
  );

  it.effect("a replaced platform bearer wakes a supervisor blocked on the old one", () =>
    Effect.gen(function* () {
      let storedCredentials: Ref.Ref<Map<string, ConnectionCredential>> | undefined;
      const harness = yield* makeHarness([], [], [], {
        beforePrepareRoute: (target) =>
          target._tag !== "BearerConnectionTarget" || storedCredentials === undefined
            ? Effect.succeed(undefined)
            : Ref.get(storedCredentials).pipe(
                Effect.map((current) =>
                  current.get(target.connectionId)?.token === "old-bearer"
                    ? new ConnectionBlockedError({ reason: "authentication", detail: "revoked" })
                    : undefined,
                ),
              ),
      });
      storedCredentials = harness.storedCredentials;

      yield* Effect.gen(function* () {
        const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
        const registration = (token: string) =>
          new BearerConnectionRegistration({
            target: BEARER_TARGET,
            profile: BEARER_PROFILE,
            credential: new BearerConnectionCredential({ token }),
          });
        yield* registry.reconcilePlatform([registration("old-bearer")]);
        yield* awaitConnectionState(
          registry,
          BEARER_TARGET.environmentId,
          (state) => state.phase === "blocked",
        );

        yield* registry.reconcilePlatform([registration("new-bearer")]);

        yield* awaitConnectionState(
          registry,
          BEARER_TARGET.environmentId,
          (state) => state.phase === "connected",
        );
      }).pipe(Effect.provide(harness.layer), Effect.scoped);
    }),
  );

  // The desktop rotates the bootstrap token, so the renderer exchanges it again
  // and the server revokes the old bearer while the socket stays open. HTTP
  // reads such as the session's scopes must move to the new bearer.
  it.effect("a replaced platform bearer reaches a connected session's HTTP requests", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness([]);

      yield* Effect.gen(function* () {
        const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
        const registration = (token: string) =>
          new BearerConnectionRegistration({
            target: BEARER_TARGET,
            profile: BEARER_PROFILE,
            credential: new BearerConnectionCredential({ token }),
          });
        const preparedToken = registry.run(
          BEARER_TARGET.environmentId,
          EnvironmentSupervisor.EnvironmentSupervisor.pipe(
            Effect.flatMap((supervisor) => SubscriptionRef.get(supervisor.prepared)),
            Effect.map((prepared) =>
              Option.isSome(prepared) && prepared.value.httpAuthorization?._tag === "Bearer"
                ? prepared.value.httpAuthorization.token
                : null,
            ),
          ),
        );
        yield* registry.reconcilePlatform([registration("old-bearer")]);
        yield* awaitConnectionState(
          registry,
          BEARER_TARGET.environmentId,
          (state) => state.phase === "connected",
        );
        expect(yield* preparedToken).toBe("old-bearer");

        yield* registry.reconcilePlatform([registration("new-bearer")]);

        expect(yield* preparedToken).toBe("new-bearer");
        expect(yield* Ref.get(harness.sessions)).toHaveLength(1);
      }).pipe(Effect.provide(harness.layer), Effect.scoped);
    }),
  );

  it.effect("a bearer replaced while an attempt is in flight retries with the new one", () =>
    Effect.gen(function* () {
      const attemptStarted = yield* Deferred.make<void>();
      const releaseFirstAttempt = yield* Deferred.make<void>();
      const attempts = yield* Ref.make(0);
      const harness = yield* makeHarness([], [], [], {
        beforePrepareRoute: (target) =>
          target._tag !== "BearerConnectionTarget"
            ? Effect.succeed(undefined)
            : Ref.updateAndGet(attempts, (count) => count + 1).pipe(
                Effect.flatMap((count) =>
                  count === 1
                    ? Deferred.succeed(attemptStarted, undefined).pipe(
                        Effect.andThen(Deferred.await(releaseFirstAttempt)),
                        Effect.as(
                          new ConnectionBlockedError({
                            reason: "authentication",
                            detail: "revoked",
                          }),
                        ),
                      )
                    : Effect.succeed(undefined),
                ),
              ),
      });

      yield* Effect.gen(function* () {
        const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
        const registration = (token: string) =>
          new BearerConnectionRegistration({
            target: BEARER_TARGET,
            profile: BEARER_PROFILE,
            credential: new BearerConnectionCredential({ token }),
          });
        yield* registry.reconcilePlatform([registration("old-bearer")]);
        yield* Deferred.await(attemptStarted).pipe(Effect.timeout("1 second"));

        yield* registry
          .stateChanges(BEARER_TARGET.environmentId)
          .pipe(Stream.runDrain, Effect.forkScoped({ startImmediately: true }));
        yield* Effect.yieldNow;
        yield* registry.reconcilePlatform([registration("new-bearer")]);
        yield* Deferred.succeed(releaseFirstAttempt, undefined);

        yield* awaitConnectionState(
          registry,
          BEARER_TARGET.environmentId,
          (state) => state.phase === "connected",
        );
        expect(yield* Ref.get(attempts)).toBeGreaterThanOrEqual(2);
      }).pipe(Effect.provide(harness.layer), Effect.scoped);
    }),
  );

  it.effect("starts platform environments without persisting or removing them", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness([]);

      yield* Effect.gen(function* () {
        const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
        yield* registry.registerPlatform(new PrimaryConnectionRegistration({ target: TARGET }));
        yield* awaitConnectionState(
          registry,
          TARGET.environmentId,
          (state) => state.phase === "connected",
        );

        expect((yield* Ref.get(harness.storedTargets)).has(TARGET.environmentId)).toBe(false);
        expect(
          (yield* SubscriptionRef.get(registry.entries)).get(TARGET.environmentId)?.target,
        ).toEqual(TARGET);

        const error = yield* Effect.flip(registry.remove(TARGET.environmentId));
        expect(error._tag).toBe("PlatformEnvironmentRemovalError");
        expect(
          (yield* SubscriptionRef.get(registry.entries)).get(TARGET.environmentId)?.target,
        ).toEqual(TARGET);
      }).pipe(Effect.provide(harness.layer));
    }),
  );

  it.effect("gives a primary platform registration precedence over persisted registrations", () =>
    Effect.gen(function* () {
      const shadowedTarget = new BearerConnectionTarget({
        environmentId: TARGET.environmentId,
        label: "Shadowed remote environment",
        connectionId: "shadowed-connection",
      });
      const harness = yield* makeHarness([shadowedTarget], [remoteProfile(shadowedTarget)]);
      const permissions = yield* makePullRequestRoutingPermissions({
        read: Effect.succeed([]),
        write: () => Effect.void,
      });
      const shadowedEntry = {
        target: shadowedTarget,
        profile: Option.some(remoteProfile(shadowedTarget)),
        enabled: true,
      };
      yield* permissions.set(shadowedEntry, "read-write");

      yield* Effect.gen(function* () {
        const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
        yield* registry.registerPlatform(new PrimaryConnectionRegistration({ target: TARGET }));
        expect(yield* permissions.get(shadowedEntry)).toBe("off");

        expect(
          (yield* SubscriptionRef.get(registry.entries)).get(TARGET.environmentId)?.target,
        ).toEqual(TARGET);
        expect((yield* Ref.get(harness.storedTargets)).has(TARGET.environmentId)).toBe(false);

        yield* registry.register(remoteRegistration(shadowedTarget));

        expect(
          (yield* SubscriptionRef.get(registry.entries)).get(TARGET.environmentId)?.target,
        ).toEqual(TARGET);
        expect((yield* Ref.get(harness.storedTargets)).has(TARGET.environmentId)).toBe(false);
      }).pipe(
        Effect.provide(harness.layer),
        Effect.provideService(PullRequestRoutingPermissions, permissions),
        Effect.scoped,
      );
    }),
  );

  it.effect("rechecks platform ownership after waiting for the environment lease", () =>
    Effect.gen(function* () {
      const registrationStarted = yield* Deferred.make<void>();
      const continueRegistration = yield* Deferred.make<void>();
      const shadowedTarget = new BearerConnectionTarget({
        environmentId: TARGET.environmentId,
        label: "Shadowed remote environment",
        connectionId: "shadowed-connection",
      });
      const harness = yield* makeHarness([], [], [], {
        beforeRegistrationRegister: () =>
          Deferred.succeed(registrationStarted, undefined).pipe(
            Effect.andThen(Deferred.await(continueRegistration)),
          ),
      });

      yield* Effect.gen(function* () {
        const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
        const persistedRegistration = yield* registry
          .register(remoteRegistration(shadowedTarget))
          .pipe(Effect.forkChild({ startImmediately: true }));
        yield* Deferred.await(registrationStarted);

        const platformRegistration = yield* registry
          .registerPlatform(new PrimaryConnectionRegistration({ target: TARGET }))
          .pipe(Effect.forkChild({ startImmediately: true }));
        yield* Effect.yieldNow;
        const removal = yield* Effect.flip(registry.remove(TARGET.environmentId)).pipe(
          Effect.forkChild({ startImmediately: true }),
        );

        yield* Deferred.succeed(continueRegistration, undefined);
        yield* Fiber.join(persistedRegistration);
        yield* Fiber.join(platformRegistration);
        const error = yield* Fiber.join(removal);

        expect(error._tag).toBe("PlatformEnvironmentRemovalError");
        expect(
          (yield* SubscriptionRef.get(registry.entries)).get(TARGET.environmentId)?.target,
        ).toEqual(TARGET);
      }).pipe(Effect.provide(harness.layer), Effect.scoped);
    }),
  );

  it.effect("does not reacquire a runtime while its registration is being removed", () =>
    Effect.gen(function* () {
      const removalStarted = yield* Deferred.make<void>();
      const continueRemoval = yield* Deferred.make<void>();
      const harness = yield* makeHarness([TARGET], [], [], {
        beforeRegistrationRemove: () =>
          Deferred.succeed(removalStarted, undefined).pipe(
            Effect.andThen(Deferred.await(continueRemoval)),
          ),
      });

      yield* Effect.gen(function* () {
        const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
        yield* registry.start;
        yield* awaitConnectionState(
          registry,
          TARGET.environmentId,
          (state) => state.phase === "connected",
        );

        const removal = yield* Effect.forkChild(registry.remove(TARGET.environmentId));
        yield* Deferred.await(removalStarted);

        const stateLookup = yield* Effect.forkChild(
          Effect.flip(registry.state(TARGET.environmentId)),
        );
        yield* Effect.yieldNow;
        expect(yield* Ref.get(harness.sessions)).toHaveLength(1);

        yield* Deferred.succeed(continueRemoval, undefined);
        yield* Fiber.join(removal);
        const error = yield* Fiber.join(stateLookup);
        expect(error._tag).toBe("EnvironmentNotRegisteredError");
      }).pipe(Effect.provide(harness.layer), Effect.scoped);
    }),
  );

  it.effect("platform refreshes preserve unsupported state for the same endpoint", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness([]);
      yield* Effect.gen(function* () {
        const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
        const registration = new PrimaryConnectionRegistration({ target: TARGET });
        yield* registry.registerPlatform(registration);
        yield* awaitConnectionState(
          registry,
          TARGET.environmentId,
          (state) => state.phase === "connected",
        );
        const error = new ConnectionBlockedError({
          reason: "unsupported",
          detail: "Use a compatible client.",
        });
        yield* registry.setCompatibility(TARGET.environmentId, error);
        yield* awaitConnectionState(
          registry,
          TARGET.environmentId,
          (state) => state.phase === "available",
        );
        yield* registry.registerPlatform(registration);
        yield* registry.reconcilePlatform([registration]);
        expect(
          (yield* SubscriptionRef.get(registry.entries)).get(TARGET.environmentId),
        ).toMatchObject({ enabled: true, unsupportedReason: error.message });
        yield* registry.registerPlatform(
          new PrimaryConnectionRegistration({
            target: new PrimaryConnectionTarget({ ...TARGET, label: "Renamed" }),
          }),
        );
        expect(yield* registry.state(TARGET.environmentId)).toMatchObject({
          desired: false,
          phase: "available",
        });
        expect(yield* Ref.get(harness.sessions)).toHaveLength(1);
        yield* registry.registerPlatform(
          new PrimaryConnectionRegistration({
            target: new PrimaryConnectionTarget({
              ...TARGET,
              httpBaseUrl: "https://changed.example.test",
            }),
          }),
        );
        yield* awaitConnectionState(
          registry,
          TARGET.environmentId,
          (state) => state.phase === "connected",
        );
        expect(
          (yield* SubscriptionRef.get(registry.entries)).get(TARGET.environmentId)
            ?.unsupportedReason,
        ).toBeUndefined();
      }).pipe(Effect.provide(harness.layer));
    }),
  );

  it.effect("keeps one session per environment across concurrent registrations and retries", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness([]);

      yield* Effect.gen(function* () {
        const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
        const registration = new PrimaryConnectionRegistration({ target: TARGET });
        yield* Effect.all(
          Array.from({ length: 5 }, () => registry.registerPlatform(registration)),
          { concurrency: "unbounded", discard: true },
        );
        yield* awaitConnectionState(
          registry,
          TARGET.environmentId,
          (state) => state.phase === "connected",
        );

        yield* Effect.all(
          [
            ...Array.from({ length: 5 }, () => registry.registerPlatform(registration)),
            ...Array.from({ length: 5 }, () => registry.retryNow(TARGET.environmentId)),
            registry.reconcilePlatform([registration]),
          ],
          { concurrency: "unbounded", discard: true },
        );
        for (let attempt = 0; attempt < 100; attempt += 1) {
          yield* Effect.yieldNow;
        }

        expect(yield* Ref.get(harness.sessions)).toHaveLength(1);
        expect(yield* Ref.get(harness.releasedSessions)).toBe(0);
        expect(yield* registry.state(TARGET.environmentId)).toMatchObject({
          phase: "connected",
          generation: 1,
        });
      }).pipe(Effect.provide(harness.layer), Effect.scoped);
    }),
  );

  it.effect("retains a healthy runtime when the platform repeats an identical registration", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness([]);
      let failWrites = false;
      const permissions = yield* makePullRequestRoutingPermissions({
        read: Effect.succeed([]),
        write: () =>
          failWrites
            ? Effect.fail(
                new ConnectionTransientError({
                  reason: "remote-unavailable",
                  detail: "Storage unavailable",
                }),
              )
            : Effect.void,
      });
      const entry = { target: TARGET, profile: Option.none(), enabled: true };

      yield* Effect.gen(function* () {
        const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
        const registration = new PrimaryConnectionRegistration({ target: TARGET });
        yield* registry.registerPlatform(registration);
        yield* awaitConnectionState(
          registry,
          TARGET.environmentId,
          (state) => state.phase === "connected",
        );
        yield* permissions.set(entry, "read-write");

        yield* registry.registerPlatform(registration);

        expect(yield* Ref.get(harness.sessions)).toHaveLength(1);
        expect(yield* permissions.get(entry)).toBe("read-write");

        const changedTarget = new PrimaryConnectionTarget({
          ...TARGET,
          httpBaseUrl: "https://changed.example.test",
        });
        failWrites = true;
        yield* registry.registerPlatform(
          new PrimaryConnectionRegistration({ target: changedTarget }),
        );
        expect(
          (yield* SubscriptionRef.get(registry.entries)).get(TARGET.environmentId)?.target,
        ).toEqual(TARGET);
        yield* registry.reconcilePlatform([]);
        expect((yield* SubscriptionRef.get(registry.entries)).has(TARGET.environmentId)).toBe(true);

        failWrites = false;
        yield* registry.registerPlatform(
          new PrimaryConnectionRegistration({ target: changedTarget }),
        );
        expect(yield* permissions.get(entry)).toBe("off");
        yield* registry.registerPlatform(registration);
        expect(yield* permissions.get(entry)).toBe("off");
        yield* permissions.set(entry, "read-write");
        yield* registry.reconcilePlatform([]);
        yield* registry.registerPlatform(registration);
        expect(yield* permissions.get(entry)).toBe("off");
      }).pipe(
        Effect.provide(harness.layer),
        Effect.provideService(PullRequestRoutingPermissions, permissions),
        Effect.scoped,
      );
    }),
  );

  it.effect("removes all owned SSH state only on explicit removal", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness(
        [SSH_CONNECTION],
        [SSH_PROFILE],
        [
          [
            SSH_CONNECTION.connectionId,
            new BearerConnectionCredential({ token: "temporary-token" }),
          ],
        ],
      );

      yield* Effect.gen(function* () {
        const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
        yield* registry.start;
        yield* registry.remove(SSH_CONNECTION.environmentId);

        expect((yield* Ref.get(harness.storedProfiles)).has(SSH_CONNECTION.connectionId)).toBe(
          false,
        );
        expect((yield* Ref.get(harness.storedCredentials)).has(SSH_CONNECTION.connectionId)).toBe(
          false,
        );
        expect(yield* Ref.get(harness.disconnectedSshTargets)).toEqual([SSH_TARGET]);
      }).pipe(Effect.provide(harness.layer));
    }),
  );
});

const LIVE_CONFIG: ServerConfig = {
  environment: {
    environmentId: BEARER_TARGET.environmentId,
    label: "Test",
    platform: { os: "linux", arch: "x64" },
    serverVersion: "test",
    orchestrationProtocolVersion: ORCHESTRATION_PROTOCOL_VERSION,
    capabilities: {},
  },
  auth: {
    policy: "loopback-browser",
    bootstrapMethods: ["one-time-token"],
    sessionMethods: ["bearer-access-token"],
    sessionCookieName: "supaterm_session",
  },
  cwd: "/tmp",
  keybindingsConfigPath: "/tmp/keybindings.json",
  keybindings: [],
  issues: [],
  providers: [],
  availableEditors: [],
  observability: {
    logsDirectoryPath: "/tmp/logs",
    localTracingEnabled: false,
    otlpTracesEnabled: false,
    otlpMetricsEnabled: false,
    otlpLogsEnabled: false,
  },
  settings: DEFAULT_SERVER_SETTINGS,
};

it.effect(
  "learns, updates, and withdraws relay on a live connection without replacing its session or credential",
  () =>
    Effect.gen(function* () {
      const config = LIVE_CONFIG;
      const configs = yield* SubscriptionRef.make(config);
      const writes = yield* Queue.unbounded<{
        routes: ReadonlyArray<ConnectionTarget>;
        profiles: ReadonlyArray<ConnectionProfile>;
      }>();
      const released = Promise.withResolvers<string>();
      const harness = yield* makeHarness(
        [BEARER_TARGET],
        [BEARER_PROFILE],
        [[BEARER_TARGET.connectionId, BEARER_CREDENTIAL]],
        {
          configChanges: SubscriptionRef.changes(configs),
          setRoutes: (_environmentId, routes, profiles = []) =>
            Queue.offer(writes, { routes, profiles }).pipe(Effect.asVoid),
        },
      );
      const relayEndpoint = `https://${"11".repeat(16)}.${"22".repeat(16)}.relay.supaterm.alt/`;
      yield* Effect.gen(function* () {
        const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
        yield* registry.start;
        yield* awaitConnectionState(
          registry,
          BEARER_TARGET.environmentId,
          (state) => state.phase === "connected",
        );
        const awaitRoutes = (predicate: (routes: ReturnType<typeof connectionRoutes>) => boolean) =>
          SubscriptionRef.changes(registry.entries).pipe(
            Stream.map((entries) => connectionRoutes(entries.get(BEARER_TARGET.environmentId)!)),
            Stream.filter(predicate),
            Stream.runHead,
            Effect.map(Option.getOrThrow),
          );
        yield* SubscriptionRef.set(configs, {
          ...config,
          environment: {
            ...config.environment,
            relayEndpoint,
            relayUrl: "wss://first.example.test",
          },
        });
        const learned = yield* awaitRoutes((routes) => routes.length === 2);
        const firstWrite = yield* Queue.take(writes);
        expect(firstWrite.routes).toEqual(learned.map((route) => route.target));
        expect(firstWrite.profiles).toEqual([Option.getOrThrow(learned.find(isLearned)!.profile)]);
        yield* SubscriptionRef.update(configs, (value) => ({
          ...value,
          availableEditors: ["file-manager"] as const,
        }));
        yield* SubscriptionRef.update(configs, (value) => ({
          ...value,
          environment: { ...value.environment, relayUrl: "wss://second.example.test" },
        }));
        const changed = yield* awaitRoutes((routes) =>
          routes.some((route) => {
            const profile = Option.getOrNull(route.profile);
            return (
              profile?._tag === "BearerConnectionProfile" &&
              profile.relayUrl === "wss://second.example.test"
            );
          }),
        );
        const secondWrite = yield* Queue.take(writes);
        expect(secondWrite.profiles).toHaveLength(1);
        expect(secondWrite.routes).toEqual(firstWrite.routes);
        expect(changed.map((route) => route.target)).toEqual(learned.map((route) => route.target));
        yield* SubscriptionRef.set(configs, config);
        expect(yield* awaitRoutes((routes) => routes.length === 1)).toEqual([
          { target: BEARER_TARGET, profile: Option.some(BEARER_PROFILE) },
        ]);
        expect((yield* Queue.take(writes)).profiles).toEqual([]);
        expect(yield* Effect.promise(() => released.promise)).toBe(relayEndpoint);
        expect(yield* Ref.get(harness.sessions)).toHaveLength(1);
        expect(yield* Ref.get(harness.releasedSessions)).toBe(0);
        expect(yield* Ref.get(harness.storedCredentials)).toEqual(
          new Map([[BEARER_TARGET.connectionId, BEARER_CREDENTIAL]]),
        );
      }).pipe(
        Effect.provide(harness.layer),
        Effect.provideService(RelayGateway, {
          available: true,
          via: () => undefined,
          subscribe: () => () => {},
          lease: () => {
            throw new Error("Unexpected pairing lease");
          },
          resolve: async (address) => address,
          release: async (address) => {
            released.resolve(address);
          },
          fetch: globalThis.fetch,
        }),
        Effect.scoped,
      );
    }),
);

it.effect("keeps the relay route's direct tunnel candidates in step with the live host", () =>
  Effect.gen(function* () {
    const relayEndpoint = `https://${"11".repeat(16)}.${"22".repeat(16)}.relay.supaterm.alt/`;
    const urls = ["ws://192.168.1.10:3773"];
    const advertised: ServerConfig = {
      ...LIVE_CONFIG,
      environment: { ...LIVE_CONFIG.environment, relayEndpoint, relayUrl: "wss://relay.test" },
      tunnelEndpoints: { address: relayEndpoint, urls },
    };
    const configs = yield* SubscriptionRef.make(advertised);
    const harness = yield* makeHarness(
      [BEARER_TARGET],
      [BEARER_PROFILE],
      [[BEARER_TARGET.connectionId, BEARER_CREDENTIAL]],
      { configChanges: SubscriptionRef.changes(configs) },
    );
    yield* Effect.gen(function* () {
      const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
      yield* registry.start;
      const relayTunnelUrls = SubscriptionRef.changes(registry.entries).pipe(
        Stream.map((entries) =>
          connectionRoutes(entries.get(BEARER_TARGET.environmentId)!).flatMap((route) => {
            const profile = Option.getOrNull(route.profile);
            return profile?._tag === "BearerConnectionProfile" &&
              profile.httpBaseUrl === relayEndpoint
              ? [profile.directTunnelUrls]
              : [];
          }),
        ),
      );
      const awaitTunnelUrls = (expected: ReadonlyArray<string> | undefined) =>
        relayTunnelUrls.pipe(
          Stream.filter(
            (found) => found.length === 1 && JSON.stringify(found[0]) === JSON.stringify(expected),
          ),
          Stream.runHead,
        );
      expect(Option.isSome(yield* awaitTunnelUrls(urls))).toBe(true);
      const { tunnelEndpoints: _omitted, ...withdrawn } = advertised;
      yield* SubscriptionRef.set(configs, withdrawn);
      expect(Option.isSome(yield* awaitTunnelUrls(undefined))).toBe(true);
    }).pipe(
      Effect.provide(harness.layer),
      Effect.provideService(RelayGateway, {
        available: true,
        via: () => undefined,
        subscribe: () => () => {},
        lease: () => {
          throw new Error("Unexpected pairing lease");
        },
        resolve: async (address) => address,
        release: async () => {},
        fetch: globalThis.fetch,
      }),
      Effect.scoped,
    );
  }),
);
