import type { DesktopSshEnvironmentTarget, EnvironmentId } from "@supaterm/contracts";
import { resolveRemotePairingTarget } from "@supaterm/shared/remote";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as HttpClient from "effect/http/HttpClient";
import * as FetchHttpClient from "effect/http/FetchHttpClient";

import { bootstrapRemoteBearerSession, fetchRemoteSessionState } from "../authorization/remote.ts";
import { deriveWsBaseUrl, normalizeHttpBaseUrl } from "../environment/endpoint.ts";
import * as ClientCapabilities from "../platform/capabilities.ts";
import {
  BearerConnectionCredential,
  BearerConnectionProfile,
  BearerConnectionRegistration,
  type ConnectionCatalogEntry,
  type ConnectionCredential,
  SshConnectionProfile,
  SshConnectionRegistration,
} from "./catalog.ts";
import * as ConnectionCredentialStore from "./credentialStore.ts";
import { mapRemoteEnvironmentError } from "./errors.ts";
import {
  BearerConnectionTarget,
  ConnectionBlockedError,
  SshConnectionTarget,
  type ConnectionAttemptError,
} from "./model.ts";
import * as Persistence from "../platform/persistence.ts";
import * as EnvironmentRegistry from "./registry.ts";
import { orchestrationProtocolCompatibilityError } from "./compatibility.ts";
import {
  connectionRouteId,
  connectionRoutes,
  credentialAllowsAddress,
  credentialConnectionId,
  isLearned,
  pairingFallbackRoutes,
  routeEntry,
  routesAt,
  sendsTokenInClear,
  sshTargetKey,
} from "./routes.ts";
import { reachPairingServer } from "./pairing.ts";

export interface PairingConnectionInput {
  readonly pairingUrl?: string;
  readonly host?: string;
  readonly pairingCode?: string;
  /** When set, the pairing must resolve to an existing environment route. */
  readonly expectedEnvironmentId?: EnvironmentId;
}

export interface SshConnectionInput {
  readonly target: DesktopSshEnvironmentTarget;
  readonly label?: string;
  readonly expectedEnvironmentId?: EnvironmentId;
}

export interface BearerConnectionUpdateInput {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly httpBaseUrl: string;
}

export class ConnectionOnboarding extends Context.Service<
  ConnectionOnboarding,
  {
    readonly registerPairing: (
      input: PairingConnectionInput,
    ) => Effect.Effect<
      EnvironmentId,
      ConnectionAttemptError | Persistence.ConnectionPersistenceError
    >;
    readonly registerSsh: (
      input: SshConnectionInput,
    ) => Effect.Effect<
      EnvironmentId,
      ConnectionAttemptError | Persistence.ConnectionPersistenceError
    >;
    readonly updateBearer: (
      input: BearerConnectionUpdateInput,
    ) => Effect.Effect<void, ConnectionAttemptError | Persistence.ConnectionPersistenceError>;
  }
>()("@supaterm/client-runtime/connection/onboarding/ConnectionOnboarding") {}

const resolvePairingTarget = Effect.fn("clientRuntime.connection.onboarding.resolvePairingTarget")(
  function* (input: PairingConnectionInput) {
    return yield* Effect.try({
      try: () => resolveRemotePairingTarget(input),
      catch: (cause) =>
        new ConnectionBlockedError({
          reason: "configuration",
          detail: cause instanceof Error ? cause.message : "The pairing details are invalid.",
        }),
    });
  },
);

/**
 * Re-pairing an address the user already paired keeps that route's id, so the
 * routes learned through it stay attached and share the new credential.
 */
function pairingConnectionId(
  entry: ConnectionCatalogEntry | undefined,
  environmentId: EnvironmentId,
  httpBaseUrl: string,
): string {
  const paired =
    entry === undefined
      ? undefined
      : routesAt(entry, httpBaseUrl).find(
          (route) => route.target._tag === "BearerConnectionTarget" && !isLearned(route),
        );
  return paired === undefined
    ? `bearer:${environmentId}:${new URL(httpBaseUrl).origin}`
    : connectionRouteId(paired.target);
}

export const preparePairingRegistration = Effect.fn(
  "clientRuntime.connection.onboarding.preparePairingRegistration",
)(
  function* (
    input: PairingConnectionInput,
    entries: ReadonlyMap<EnvironmentId, ConnectionCatalogEntry>,
  ) {
    const target = yield* resolvePairingTarget(input);
    const presentation = yield* ClientCapabilities.ClientPresentation;
    if (
      input.expectedEnvironmentId !== undefined &&
      target.environmentId !== undefined &&
      input.expectedEnvironmentId !== target.environmentId
    ) {
      return yield* new ConnectionBlockedError({
        reason: "configuration",
        detail: "This pairing link belongs to a different environment.",
      });
    }
    const expected = input.expectedEnvironmentId ?? target.environmentId;
    const reached = yield* reachPairingServer({
      httpBaseUrl: target.httpBaseUrl,
      relayUrl: target.relayUrl,
      expectedEnvironmentId: expected,
      fallback: pairingFallbackRoutes(entries, target.httpBaseUrl, expected),
      routes: target.routes ?? [],
    });
    const { descriptor } = reached;
    const compatibilityError = orchestrationProtocolCompatibilityError(descriptor);
    // An outdated server is still saved so it can be updated from this client.
    if (compatibilityError !== null && compatibilityError.serverUpdateRequired !== true) {
      return yield* compatibilityError;
    }
    const registrationHttpBaseUrl =
      reached.source === "hint" ? reached.httpBaseUrl : target.httpBaseUrl;
    const connectionId = pairingConnectionId(
      entries.get(descriptor.environmentId),
      descriptor.environmentId,
      registrationHttpBaseUrl,
    );

    const route = {
      target: new BearerConnectionTarget({
        environmentId: descriptor.environmentId,
        label: descriptor.label,
        connectionId,
      }),
      profile: new BearerConnectionProfile({
        connectionId,
        environmentId: descriptor.environmentId,
        label: descriptor.label,
        httpBaseUrl: registrationHttpBaseUrl,
        wsBaseUrl: deriveWsBaseUrl(registrationHttpBaseUrl),
        ...(target.relayUrl !== undefined && registrationHttpBaseUrl === target.httpBaseUrl
          ? { relayUrl: target.relayUrl }
          : {}),
      }),
    };
    if (input.expectedEnvironmentId === undefined) {
      yield* EnvironmentRegistry.assertKnownAddress(entries, {
        target: route.target,
        profile: Option.some(route.profile),
      });
    }
    const access = yield* bootstrapRemoteBearerSession({
      httpBaseUrl: reached.httpBaseUrl,
      credential: target.credential,
      clientMetadata: presentation.metadata,
    }).pipe(Effect.mapError(mapRemoteEnvironmentError));
    const registration = new BearerConnectionRegistration({
      ...route,
      credential: new BearerConnectionCredential({ token: access.access_token }),
    });
    return { registration, reachedHttpBaseUrl: reached.httpBaseUrl };
  },
  Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" }),
);

const isBearerCredential = Schema.is(BearerConnectionCredential);

const refreshReachedRouteCredential = Effect.fn(
  "clientRuntime.connection.onboarding.refreshReachedRouteCredential",
)(
  function* (registration: BearerConnectionRegistration, reachedHttpBaseUrl: string) {
    const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
    const credentials = yield* ConnectionCredentialStore.ConnectionCredentialStore;
    const entry = (yield* SubscriptionRef.get(registry.entries)).get(
      registration.target.environmentId,
    );
    if (entry === undefined) return;
    const reachedRoute = routesAt(entry, reachedHttpBaseUrl).find(
      (route) => route.target._tag === "BearerConnectionTarget",
    );
    // The route borrows another route's credential; checking it here must not
    // carry that credential somewhere a connect would refuse to send it.
    if (reachedRoute === undefined || sendsTokenInClear(connectionRoutes(entry), reachedRoute))
      return;
    const connectionId = credentialConnectionId(connectionRouteId(reachedRoute.target));
    if (connectionId === registration.target.connectionId) return;
    const current = Option.getOrUndefined(yield* credentials.get(connectionId));
    if (current !== undefined && isBearerCredential(current)) {
      const session = yield* fetchRemoteSessionState({
        httpBaseUrl: reachedHttpBaseUrl,
        bearerToken: current.token,
      });
      if (session.authenticated) return;
    }
    yield* credentials.put(connectionId, registration.credential);
  },
  Effect.catch((error) =>
    Effect.logWarning("Could not refresh the credential of the reached route.", { error }),
  ),
  Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" }),
);

const registerPairingConnection = Effect.fn(
  "clientRuntime.connection.onboarding.registerPairingConnection",
)(function* (input: PairingConnectionInput) {
  const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
  const { registration, reachedHttpBaseUrl } = yield* preparePairingRegistration(
    input,
    yield* SubscriptionRef.get(registry.entries),
  );
  yield* refreshReachedRouteCredential(registration, reachedHttpBaseUrl);
  if (
    !(yield* registry.register(registration, {
      knownAddressOnly: input.expectedEnvironmentId === undefined,
    }))
  )
    return registration.target.environmentId;
  yield* registry.setCompatibility(registration.target.environmentId, null);
  yield* registry
    .setEnabled(registration.target.environmentId, true)
    .pipe(Effect.catchTags({ EnvironmentNotRegisteredError: () => Effect.void }));
  return registration.target.environmentId;
});

const isBearerProfile = Schema.is(BearerConnectionProfile);

const updateBearerConnection = Effect.fn(
  "clientRuntime.connection.onboarding.updateBearerConnection",
)(function* (input: BearerConnectionUpdateInput) {
  const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
  const credentials = yield* ConnectionCredentialStore.ConnectionCredentialStore;
  const saved = (yield* SubscriptionRef.get(registry.entries)).get(input.environmentId);
  const route =
    saved === undefined
      ? undefined
      : connectionRoutes(saved).find(
          (candidate) =>
            candidate.target._tag === "BearerConnectionTarget" && !isLearned(candidate),
        );
  const entry = saved === undefined || route === undefined ? saved : routeEntry(saved, route);
  const credential =
    entry?.target._tag === "BearerConnectionTarget"
      ? yield* credentials.get(entry.target.connectionId)
      : Option.none();
  const registration = yield* prepareBearerConnectionUpdate({
    input,
    entry: Option.fromUndefinedOr(entry),
    credential,
  });
  yield* registry.register(registration);
});

export const prepareBearerConnectionUpdate = Effect.fn(
  "clientRuntime.connection.onboarding.prepareBearerConnectionUpdate",
)(function* (options: {
  readonly input: BearerConnectionUpdateInput;
  readonly entry: Option.Option<ConnectionCatalogEntry>;
  readonly credential: Option.Option<ConnectionCredential>;
}) {
  const entry = Option.getOrNull(options.entry);
  if (
    entry === undefined ||
    entry === null ||
    entry.target._tag !== "BearerConnectionTarget" ||
    Option.isNone(entry.profile) ||
    !isBearerProfile(entry.profile.value)
  ) {
    return yield* new ConnectionBlockedError({
      reason: "configuration",
      detail: "Only saved bearer environments can be edited.",
    });
  }

  const credential = options.credential;
  if (Option.isNone(credential) || !isBearerCredential(credential.value)) {
    return yield* new ConnectionBlockedError({
      reason: "authentication",
      detail: "The saved bearer credential is unavailable.",
    });
  }

  const label = options.input.label.trim();
  if (label === "") {
    return yield* new ConnectionBlockedError({
      reason: "configuration",
      detail: "Environment label cannot be empty.",
    });
  }
  const httpBaseUrl = yield* Effect.try({
    try: () => normalizeHttpBaseUrl(options.input.httpBaseUrl),
    catch: (cause) =>
      new ConnectionBlockedError({
        reason: "configuration",
        detail: cause instanceof Error ? cause.message : "The environment URL is invalid.",
      }),
  });
  if (!credentialAllowsAddress({ target: entry.target, profile: entry.profile }, httpBaseUrl)) {
    return yield* new ConnectionBlockedError({
      reason: "configuration",
      detail:
        "This route's token was paired over an encrypted connection and can't move to this address. Pair again at the new address.",
    });
  }
  const connectionId = entry.target.connectionId;
  const { relayUrl, directTunnelUrls } = entry.profile.value;
  const sameAddress = httpBaseUrl === entry.profile.value.httpBaseUrl;
  return new BearerConnectionRegistration({
    target: new BearerConnectionTarget({
      environmentId: options.input.environmentId,
      label,
      connectionId,
    }),
    profile: new BearerConnectionProfile({
      connectionId,
      environmentId: options.input.environmentId,
      label,
      httpBaseUrl,
      wsBaseUrl: deriveWsBaseUrl(httpBaseUrl),
      ...(relayUrl !== undefined && sameAddress ? { relayUrl } : {}),
      ...(directTunnelUrls !== undefined && sameAddress ? { directTunnelUrls } : {}),
    }),
    credential: credential.value,
  });
});

export const prepareSshRegistration = Effect.fn(
  "clientRuntime.connection.onboarding.prepareSshRegistration",
)(function* (input: SshConnectionInput) {
  const gateway = yield* ClientCapabilities.SshEnvironmentGateway;
  const provisioned = yield* gateway.provision(input.target, input.expectedEnvironmentId);
  if (
    input.expectedEnvironmentId !== undefined &&
    provisioned.environmentId !== input.expectedEnvironmentId
  ) {
    return yield* new ConnectionBlockedError({
      reason: "configuration",
      detail: "The SSH target belongs to a different environment.",
    });
  }
  const connectionId = `ssh:${provisioned.environmentId}:${sshTargetKey(provisioned.bootstrap.target)}`;
  const label = input.label?.trim() || provisioned.label || provisioned.bootstrap.target.alias;

  return new SshConnectionRegistration({
    target: new SshConnectionTarget({
      environmentId: provisioned.environmentId,
      label,
      connectionId,
    }),
    profile: new SshConnectionProfile({
      connectionId,
      environmentId: provisioned.environmentId,
      label,
      target: provisioned.bootstrap.target,
    }),
    credential: new BearerConnectionCredential({ token: provisioned.bearerToken }),
  });
});

const registerSshConnection = Effect.fn(
  "clientRuntime.connection.onboarding.registerSshConnection",
)(function* (input: SshConnectionInput) {
  const registration = yield* prepareSshRegistration(input);
  const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
  yield* registry.register(registration);
  return registration.target.environmentId;
});

const make = Effect.gen(function* () {
  const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
  const presentation = yield* ClientCapabilities.ClientPresentation;
  const httpClient = yield* HttpClient.HttpClient;
  const ssh = yield* ClientCapabilities.SshEnvironmentGateway;
  const credentials = yield* ConnectionCredentialStore.ConnectionCredentialStore;

  return ConnectionOnboarding.of({
    registerPairing: Effect.fnUntraced(
      function* (input) {
        return yield* registerPairingConnection(input);
      },
      Effect.provideService(EnvironmentRegistry.EnvironmentRegistry, registry),
      Effect.provideService(ClientCapabilities.ClientPresentation, presentation),
      Effect.provideService(HttpClient.HttpClient, httpClient),
      Effect.provideService(ConnectionCredentialStore.ConnectionCredentialStore, credentials),
    ),
    registerSsh: Effect.fnUntraced(
      function* (input) {
        return yield* registerSshConnection(input);
      },
      Effect.provideService(EnvironmentRegistry.EnvironmentRegistry, registry),
      Effect.provideService(ClientCapabilities.SshEnvironmentGateway, ssh),
    ),
    updateBearer: Effect.fnUntraced(
      function* (input) {
        return yield* updateBearerConnection(input);
      },
      Effect.provideService(EnvironmentRegistry.EnvironmentRegistry, registry),
      Effect.provideService(ConnectionCredentialStore.ConnectionCredentialStore, credentials),
    ),
  });
});

export const layer = Layer.effect(ConnectionOnboarding, make);
