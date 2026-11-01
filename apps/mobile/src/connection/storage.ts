import {
  registerConnectionInCatalog,
  removeConnectionFromCatalog,
  setConnectionEnabledInCatalog,
  setPlatformLabelInCatalog,
  setRoutesInCatalog,
  removeCatalogValue,
  replaceCatalogValue,
  Persistence,
} from "@supaterm/client-runtime/platform";
import {
  ConnectionTransientError,
  CredentialStore,
  ProfileStore,
  PullRequestRoutingPermissions,
  makePullRequestRoutingPermissions,
} from "@supaterm/client-runtime/connection";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as CatalogStore from "./catalog-store";

function targetPersistenceError(
  operation:
    | "list-targets"
    | "list-disabled-targets"
    | "list-platform-labels"
    | "register-connection"
    | "set-connection-routes"
    | "remove-connection"
    | "set-connection-enabled"
    | "set-platform-label",
  error: ConnectionTransientError,
) {
  return new Persistence.ConnectionPersistenceError({
    operation,
    message: error.message,
  });
}

export const layer = Layer.effectContext(
  Effect.gen(function* () {
    const catalog = yield* CatalogStore.make();
    const githubRoutingPermissions = yield* makePullRequestRoutingPermissions({
      read: catalog.read.pipe(Effect.map((document) => document.githubRoutingPermissions ?? [])),
      write: (githubRoutingPermissions) =>
        catalog.update((document) => ({ ...document, githubRoutingPermissions })),
    });

    const targetStore = Persistence.ConnectionTargetStore.of({
      list: catalog.read.pipe(
        Effect.map((document) => document.targets),
        Effect.mapError((error) => targetPersistenceError("list-targets", error)),
      ),
      listDisabled: catalog.read.pipe(
        Effect.map((document) => document.disabledEnvironmentIds),
        Effect.mapError((error) => targetPersistenceError("list-disabled-targets", error)),
      ),
      listPlatformLabels: catalog.read.pipe(
        Effect.map((document) => document.platformLabels),
        Effect.mapError((error) => targetPersistenceError("list-platform-labels", error)),
      ),
    });
    const registrationStore = Persistence.ConnectionRegistrationStore.of({
      setPlatformLabel: (environmentId, label) =>
        catalog
          .update((document) => setPlatformLabelInCatalog(document, environmentId, label))
          .pipe(Effect.mapError((error) => targetPersistenceError("set-platform-label", error))),
      register: (registration, routes) =>
        catalog
          .update((document) => registerConnectionInCatalog(document, registration, routes))
          .pipe(Effect.mapError((error) => targetPersistenceError("register-connection", error))),
      setRoutes: (environmentId, routes, profiles) =>
        catalog
          .update((document) => setRoutesInCatalog(document, environmentId, routes, profiles))
          .pipe(Effect.mapError((error) => targetPersistenceError("set-connection-routes", error))),
      remove: (target) =>
        catalog
          .update((document) => removeConnectionFromCatalog(document, target))
          .pipe(Effect.mapError((error) => targetPersistenceError("remove-connection", error))),
      setEnabled: (environmentId, enabled) =>
        catalog
          .update((document) => setConnectionEnabledInCatalog(document, environmentId, enabled))
          .pipe(
            Effect.mapError((error) => targetPersistenceError("set-connection-enabled", error)),
          ),
    });
    const profileStore = ProfileStore.make({
      get: (connectionId) =>
        catalog.read.pipe(
          Effect.map((document) =>
            Option.fromUndefinedOr(
              document.profiles.find((candidate) => candidate.connectionId === connectionId),
            ),
          ),
        ),
      put: (profile) =>
        catalog.update((document) => ({
          ...document,
          profiles: replaceCatalogValue(document.profiles, (value) => value.connectionId, profile),
        })),
      remove: (connectionId) =>
        catalog.update((document) => ({
          ...document,
          profiles: removeCatalogValue(
            document.profiles,
            (value) => value.connectionId,
            connectionId,
          ),
        })),
    });
    const credentialStore = CredentialStore.make({
      get: (connectionId) =>
        catalog.read.pipe(
          Effect.map((document) =>
            Option.fromUndefinedOr(
              document.credentials.find((entry) => entry.connectionId === connectionId)?.credential,
            ),
          ),
        ),
      put: (connectionId, credential) =>
        catalog.update((document) => ({
          ...document,
          credentials: replaceCatalogValue(document.credentials, (value) => value.connectionId, {
            connectionId,
            credential,
          }),
        })),
      remove: (connectionId) =>
        catalog.update((document) => ({
          ...document,
          credentials: removeCatalogValue(
            document.credentials,
            (value) => value.connectionId,
            connectionId,
          ),
        })),
    });
    return Context.make(Persistence.ConnectionTargetStore, targetStore).pipe(
      Context.add(PullRequestRoutingPermissions, githubRoutingPermissions),
      Context.add(Persistence.ConnectionRegistrationStore, registrationStore),
      Context.add(ProfileStore.ConnectionProfileStore, profileStore),
      Context.add(CredentialStore.ConnectionCredentialStore, credentialStore),
    );
  }),
);
