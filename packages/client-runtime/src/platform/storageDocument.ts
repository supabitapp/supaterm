import { EnvironmentId, ForwardCompatibleArray } from "@supaterm/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  type ConnectionRegistration,
  ConnectionCredential,
  ConnectionProfile,
} from "../connection/catalog.ts";
import { type ConnectionTarget, PersistedConnectionTarget } from "../connection/model.ts";
import { StoredGitHubRoutingPermission } from "../connection/githubRoutingPermissions.ts";

export const StoredConnectionCredential = Schema.Struct({
  connectionId: Schema.String,
  credential: ConnectionCredential,
});
export type StoredConnectionCredential = typeof StoredConnectionCredential.Type;

export const ConnectionCatalogDocument = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  targets: ForwardCompatibleArray(PersistedConnectionTarget),
  profiles: Schema.Array(ConnectionProfile),
  credentials: Schema.Array(StoredConnectionCredential),
  githubRoutingPermissions: Schema.optionalKey(Schema.Array(StoredGitHubRoutingPermission)),
  disabledEnvironmentIds: Schema.Array(EnvironmentId).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed([])),
  ),
});
export type ConnectionCatalogDocument = typeof ConnectionCatalogDocument.Type;

export const EMPTY_CONNECTION_CATALOG_DOCUMENT: ConnectionCatalogDocument = Object.freeze({
  schemaVersion: 1,
  targets: [],
  profiles: [],
  credentials: [],
  disabledEnvironmentIds: [],
});

export function replaceCatalogValue<A>(
  values: ReadonlyArray<A>,
  key: (value: A) => string,
  next: A,
): ReadonlyArray<A> {
  const nextKey = key(next);
  return [...values.filter((value) => key(value) !== nextKey), next];
}

export function removeCatalogValue<A>(
  values: ReadonlyArray<A>,
  key: (value: A) => string,
  removedKey: string,
): ReadonlyArray<A> {
  return values.filter((value) => key(value) !== removedKey);
}

function connectionIdOf(target: ConnectionTarget): string | null {
  switch (target._tag) {
    case "PrimaryConnectionTarget":
      return null;
    case "BearerConnectionTarget":
    case "SshConnectionTarget":
      return target.connectionId;
  }
}

function routeKey(target: ConnectionTarget): string {
  return connectionIdOf(target) ?? target._tag;
}

function removeRouteMetadata(
  document: ConnectionCatalogDocument,
  removed: ReadonlyArray<ConnectionTarget>,
): ConnectionCatalogDocument {
  const connectionIds = new Set(removed.flatMap((target) => connectionIdOf(target) ?? []));
  return {
    ...document,
    profiles: document.profiles.filter((value) => !connectionIds.has(value.connectionId)),
    credentials: document.credentials.filter((value) => !connectionIds.has(value.connectionId)),
  };
}

function catalogRoutes(
  document: ConnectionCatalogDocument,
  environmentId: EnvironmentId,
): ReadonlyArray<PersistedConnectionTarget> {
  return document.targets.filter((target) => target.environmentId === environmentId);
}

export function setRoutesInCatalog(
  document: ConnectionCatalogDocument,
  environmentId: EnvironmentId,
  routes: ReadonlyArray<PersistedConnectionTarget>,
  profiles: ReadonlyArray<ConnectionProfile> = [],
): ConnectionCatalogDocument {
  const kept = new Set(routes.map(routeKey));
  const dropped = catalogRoutes(document, environmentId).filter(
    (target) => !kept.has(routeKey(target)),
  );
  const firstIndex = document.targets.findIndex((target) => target.environmentId === environmentId);
  const others = document.targets.filter((target) => target.environmentId !== environmentId);
  const insertAt =
    firstIndex === -1
      ? others.length
      : document.targets
          .slice(0, firstIndex)
          .filter((target) => target.environmentId !== environmentId).length;
  const saved = removeRouteMetadata(document, dropped);
  return {
    ...saved,
    profiles: profiles.reduce(
      (current, profile) => replaceCatalogValue(current, (value) => value.connectionId, profile),
      saved.profiles,
    ),
    targets: [...others.slice(0, insertAt), ...routes, ...others.slice(insertAt)],
  };
}

export function registerConnectionInCatalog(
  document: ConnectionCatalogDocument,
  registration: ConnectionRegistration,
  routes: ReadonlyArray<PersistedConnectionTarget> = [registration.target],
): ConnectionCatalogDocument {
  const hadExisting = document.targets.some(
    (target) => target.environmentId === registration.target.environmentId,
  );
  const saved = setRoutesInCatalog(document, registration.target.environmentId, routes);
  const next = hadExisting
    ? saved
    : {
        ...saved,
        disabledEnvironmentIds: removeCatalogValue(
          saved.disabledEnvironmentIds,
          (value) => value,
          registration.target.environmentId,
        ),
      };
  switch (registration._tag) {
    case "BearerConnectionRegistration":
    case "SshConnectionRegistration":
      return {
        ...next,
        profiles: replaceCatalogValue(
          next.profiles,
          (value) => value.connectionId,
          registration.profile,
        ),
        credentials: replaceCatalogValue(next.credentials, (value) => value.connectionId, {
          connectionId: registration.target.connectionId,
          credential: registration.credential,
        }),
      };
  }
}

export function removeConnectionFromCatalog(
  document: ConnectionCatalogDocument,
  environmentOrTarget: EnvironmentId | ConnectionTarget,
): ConnectionCatalogDocument {
  const environmentId =
    typeof environmentOrTarget === "string"
      ? environmentOrTarget
      : environmentOrTarget.environmentId;
  const dropped = catalogRoutes(document, environmentId);
  const next = setRoutesInCatalog(document, environmentId, []);
  return {
    ...removeRouteMetadata(next, dropped),
    disabledEnvironmentIds: removeCatalogValue(
      next.disabledEnvironmentIds,
      (value) => value,
      environmentId,
    ),
    ...(next.githubRoutingPermissions === undefined
      ? {}
      : {
          githubRoutingPermissions: next.githubRoutingPermissions.filter(
            (permission) => permission.environmentId !== environmentId,
          ),
        }),
  };
}

export function setConnectionEnabledInCatalog(
  document: ConnectionCatalogDocument,
  environmentId: EnvironmentId,
  enabled: boolean,
): ConnectionCatalogDocument {
  const registered = document.targets.some((target) => target.environmentId === environmentId);
  const without = removeCatalogValue(
    document.disabledEnvironmentIds,
    (value) => value,
    environmentId,
  );
  return {
    ...document,
    disabledEnvironmentIds: registered && !enabled ? [...without, environmentId] : without,
  };
}
