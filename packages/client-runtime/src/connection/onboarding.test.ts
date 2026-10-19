import {
  AuthStandardClientScopes,
  EnvironmentId,
  type AuthEnvironmentScope,
  ORCHESTRATION_PROTOCOL_VERSION,
} from "@supaterm/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as TestClock from "effect/testing/TestClock";
import { buildPairingUrl } from "@supaterm/shared/remote";

import { RelayGateway, layer as layerRelayGateway } from "../relay/gateway.ts";
import * as RpcHttp from "../rpc/http.ts";
import * as ClientCapabilities from "../platform/capabilities.ts";
import * as Persistence from "../platform/persistence.ts";
import { fetchRemoteSessionState } from "../authorization/remote.ts";
import {
  BearerConnectionCredential,
  BearerConnectionProfile,
  BearerConnectionRegistration,
  PrimaryConnectionRegistration,
  type ConnectionCatalogEntry,
  type ConnectionCredential,
  type ConnectionRegistration,
  type ConnectionRoute,
} from "./catalog.ts";
import * as Connectivity from "./connectivity.ts";
import * as CredentialStore from "./credentialStore.ts";
import * as ConnectionDriver from "./driver.ts";
import {
  BearerConnectionTarget,
  ConnectionBlockedError,
  PrimaryConnectionTarget,
} from "./model.ts";
import {
  ConnectionOnboarding,
  layer as layerConnectionOnboarding,
  prepareBearerConnectionUpdate,
  preparePairingRegistration,
  prepareSshRegistration,
} from "./onboarding.ts";
import * as EnvironmentRegistry from "./registry.ts";
import { ROUTE_CHECK_TIMEOUT_MS } from "./driver.ts";
import * as ConnectionProfileStore from "./profileStore.ts";
import { entryWithRoutes } from "./routes.ts";
import * as ConnectionWakeups from "./wakeups.ts";

const layerClientPresentation = Layer.succeed(
  ClientCapabilities.ClientPresentation,
  ClientCapabilities.ClientPresentation.of({
    metadata: {
      label: "Supaterm Test",
      deviceType: "desktop",
      os: "Test OS",
    },
  }),
);

type Call = { readonly url: string; readonly init: RequestInit };
type Server = (path: string, init: RequestInit) => Response;

/**
 * Answers the origins a test lists. A silent origin never answers, like a LAN
 * address from cellular; every other address fails at once.
 */
function layerRoutedHttp(
  calls: Array<Call>,
  servers: Record<string, Server | "silent">,
  silenced?: Deferred.Deferred<void>,
) {
  const fetchFn = ((input, init = {}) => {
    const url = new URL(String(input));
    calls.push({ url: url.href, init });
    const server = servers[url.origin];
    if (server === "silent") {
      if (silenced !== undefined) Deferred.doneUnsafe(silenced, Effect.void);
      return new Promise<Response>((_, reject) =>
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason)),
      );
    }
    return server === undefined
      ? Promise.reject(new TypeError("Network request failed"))
      : Promise.resolve(server(url.pathname, init));
  }) satisfies typeof fetch;
  return RpcHttp.layerRemoteHttpClient(fetchFn);
}

function pairingServer(options?: {
  readonly environmentId?: string;
  readonly protocolVersion?: number;
  readonly selfUpdate?: boolean;
  readonly failDescriptor?: boolean;
  readonly failExchange?: boolean;
  readonly failSession?: boolean;
  readonly acceptedTokens?: ReadonlyArray<string>;
  readonly grantScopes?: ReadonlyArray<AuthEnvironmentScope>;
}): Server {
  const grantScopes = options?.grantScopes ?? AuthStandardClientScopes;
  let sessionScopes: ReadonlyArray<string> = [];
  let exchanged = false;
  return (path, init) => {
    if (path === "/.well-known/supaterm/environment") {
      if (options?.failDescriptor === true) {
        return Response.json({ message: "descriptor unavailable" }, { status: 503 });
      }
      return Response.json({
        environmentId: options?.environmentId ?? "environment-paired",
        label: "Paired environment",
        platform: {
          os: "linux",
          arch: "x64",
        },
        serverVersion: "0.0.0-test",
        orchestrationProtocolVersion: options?.protocolVersion ?? ORCHESTRATION_PROTOCOL_VERSION,
        capabilities: options?.selfUpdate === true ? { serverSelfUpdate: "boot-service" } : {},
      });
    }
    if (path === "/oauth/token") {
      if (options?.failExchange === true) {
        return Response.json(
          {
            _tag: "EnvironmentAuthInvalidError",
            code: "auth_invalid",
            reason: "invalid_credential",
            traceId: "trace-pairing-test",
          },
          { status: 401 },
        );
      }
      const body =
        init.body instanceof Uint8Array ? new TextDecoder().decode(init.body) : String(init.body);
      const requestedScope = new URLSearchParams(body).get("scope");
      sessionScopes = requestedScope === null ? grantScopes : requestedScope.split(" ");
      if (!sessionScopes.every((scope) => grantScopes.some((granted) => granted === scope))) {
        return Response.json(
          {
            _tag: "EnvironmentRequestInvalidError",
            code: "invalid_request",
            reason: "scope_not_granted",
            traceId: "pairing-scope-test",
          },
          { status: 400 },
        );
      }
      exchanged = true;
      return Response.json({
        access_token: "bearer-token",
        issued_token_type: "urn:ietf:params:oauth:token-type:access_token",
        token_type: "Bearer",
        expires_in: 3600,
        scope: sessionScopes.join(" "),
      });
    }
    if (path === "/api/auth/session") {
      if (options?.failSession === true) {
        return Response.json({ message: "unavailable" }, { status: 500 });
      }
      return Response.json({
        authenticated:
          (options?.acceptedTokens ?? []).includes(bearerToken(init) ?? "") ||
          (exchanged && bearerToken(init) === "bearer-token"),
        auth: {
          policy: "remote-reachable",
          bootstrapMethods: ["one-time-token"],
          sessionMethods: ["bearer-access-token"],
          sessionCookieName: "supaterm_session",
        },
        scopes: sessionScopes,
        sessionMethod: "bearer-access-token",
      });
    }
    return Response.json({ message: "not found" }, { status: 404 });
  };
}

function bearerToken(init: RequestInit): string | undefined {
  return new Headers(init.headers).get("authorization")?.replace(/^Bearer /, "");
}

const REMOTE = "https://remote.example.test";
const NO_SAVED_ENVIRONMENTS = new Map<EnvironmentId, ConnectionCatalogEntry>();
const SAVED_ENVIRONMENT_ID = EnvironmentId.make("environment-paired");
const LAN = "http://192.168.1.10:3773";
const TAILNET = "https://minim5.tail.ts.net";
const TAILNET_CONNECTION = `bearer:environment-paired:${TAILNET}`;
const PAIRING_LINK = `${LAN}/#token=pairing-token`;
const ROUTED_PAIRING_LINK = buildPairingUrl(LAN, "pairing-token", {
  environmentId: SAVED_ENVIRONMENT_ID,
  routes: [TAILNET],
});

function savedRoute(httpBaseUrl: string, connectionId: string, learned?: true) {
  return {
    target: new BearerConnectionTarget({
      environmentId: SAVED_ENVIRONMENT_ID,
      label: "minim5",
      connectionId,
    }),
    profile: Option.some(
      new BearerConnectionProfile({
        connectionId,
        environmentId: SAVED_ENVIRONMENT_ID,
        label: "minim5",
        httpBaseUrl: `${httpBaseUrl}/`,
        wsBaseUrl: `${httpBaseUrl.replace(/^http/, "ws")}/`,
        ...(learned ? { learned } : {}),
      }),
    ),
  };
}

function savedEnvironment(
  first: ConnectionRoute,
  ...rest: ReadonlyArray<ConnectionRoute>
): ReadonlyMap<EnvironmentId, ConnectionCatalogEntry> {
  const base = { target: first.target, profile: first.profile, enabled: true };
  return new Map([[SAVED_ENVIRONMENT_ID, entryWithRoutes(base, [first, ...rest])]]);
}

/** Paired over Tailscale; the LAN address was learned later. */
const PAIRED_OVER_TAILNET = savedEnvironment(
  savedRoute(LAN, `learned:environment-paired:${LAN}@${TAILNET_CONNECTION}`, true),
  savedRoute(TAILNET, TAILNET_CONNECTION),
);

const urls = (calls: ReadonlyArray<Call>) => calls.map((call) => call.url);

/** Runs `registerPairing` against a registry holding `entries`, recording what it persists. */
const registerPairing = Effect.fnUntraced(function* (options: {
  readonly pairingUrl: string;
  readonly entries: ReadonlyMap<EnvironmentId, ConnectionCatalogEntry>;
  readonly credentials: ReadonlyArray<readonly [string, string]>;
  readonly servers: Record<string, Server | "silent">;
}) {
  const calls: Array<Call> = [];
  const events: Array<string> = [];
  const stored = new Map<string, ConnectionCredential>(
    options.credentials.map(([connectionId, token]) => [
      connectionId,
      new BearerConnectionCredential({ token }),
    ]),
  );
  const entries = yield* SubscriptionRef.make(options.entries);
  const registry = EnvironmentRegistry.EnvironmentRegistry.of({
    entries,
    register: (registration: ConnectionRegistration) =>
      Effect.sync(() => {
        events.push(`register:${registration.target.connectionId}`);
        return true;
      }),
    setCompatibility: () => Effect.void,
    setEnabled: () => Effect.void,
  } as unknown as EnvironmentRegistry.EnvironmentRegistry["Service"]);
  const credentialStore = CredentialStore.make({
    get: (connectionId) => Effect.sync(() => Option.fromUndefinedOr(stored.get(connectionId))),
    put: (connectionId, credential) =>
      Effect.sync(() => {
        events.push(`put:${connectionId}`);
        stored.set(connectionId, credential);
      }),
    remove: (connectionId) => Effect.sync(() => stored.delete(connectionId)),
  });
  const onboarding = yield* ConnectionOnboarding.pipe(
    Effect.provide(
      layerConnectionOnboarding.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(EnvironmentRegistry.EnvironmentRegistry, registry),
            Layer.succeed(CredentialStore.ConnectionCredentialStore, credentialStore),
            layerClientPresentation,
            layerRoutedHttp(calls, options.servers),
            Layer.succeed(
              ClientCapabilities.SshEnvironmentGateway,
              {} as ClientCapabilities.SshEnvironmentGateway["Service"],
            ),
          ),
        ),
      ),
    ),
  );
  yield* onboarding.registerPairing({ pairingUrl: options.pairingUrl });
  return { calls, events, token: (connectionId: string) => stored.get(connectionId)?.token };
});

function layerPairingOnboarding(options?: Parameters<typeof pairingServer>[0]) {
  const dependencies = Layer.mergeAll(
    layerClientPresentation,
    layerRoutedHttp([], { [REMOTE]: pairingServer(options) }),
    Layer.mock(Persistence.ConnectionTargetStore)({
      list: Effect.succeed([]),
      listDisabled: Effect.succeed([]),
      listPlatformLabels: Effect.succeed([]),
    }),
    Layer.mock(Persistence.ConnectionRegistrationStore)({
      register: () => Effect.void,
      setEnabled: () => Effect.void,
    }),
    Layer.mock(Persistence.EnvironmentCacheStore)({}),
    Layer.mock(ConnectionProfileStore.ConnectionProfileStore)({}),
    Layer.succeed(
      CredentialStore.ConnectionCredentialStore,
      CredentialStore.make({
        get: () => Effect.succeedNone,
        put: () => Effect.void,
        remove: () => Effect.void,
      }),
    ),
    Layer.mock(ClientCapabilities.SshEnvironmentGateway)({}),
    Layer.succeed(
      Connectivity.Connectivity,
      Connectivity.Connectivity.of({ status: Effect.succeed("online"), changes: Stream.never }),
    ),
    Layer.mock(ConnectionDriver.ConnectionDriver)({
      checkRoute: () => Effect.succeed("unchecked"),
      preflight: () => Effect.succeedNone,
      connect: () => Effect.never,
    }),
    Layer.succeed(
      ConnectionWakeups.ConnectionWakeups,
      ConnectionWakeups.ConnectionWakeups.of({ changes: Stream.never }),
    ),
  );
  return layerConnectionOnboarding.pipe(
    Layer.provideMerge(EnvironmentRegistry.layer.pipe(Layer.provideMerge(dependencies))),
  );
}

const PAIRED_ENVIRONMENT_ID = EnvironmentId.make("environment-paired");
const PAIRING_INPUT = { host: "remote.example.test", pairingCode: "pairing-token" };
const PAIRED_PROFILE = new BearerConnectionProfile({
  connectionId: "bearer:environment-paired:https://remote.example.test",
  environmentId: PAIRED_ENVIRONMENT_ID,
  label: "Paired environment",
  httpBaseUrl: "https://remote.example.test/",
  wsBaseUrl: "wss://remote.example.test/",
});
const UNSUPPORTED_ERROR = new ConnectionBlockedError({
  reason: "unsupported",
  detail: "The saved server used an incompatible orchestration protocol.",
});

const registerSwitchedOffEnvironment = Effect.gen(function* () {
  const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
  const registration = new BearerConnectionRegistration({
    target: new BearerConnectionTarget({
      environmentId: PAIRED_ENVIRONMENT_ID,
      connectionId: PAIRED_PROFILE.connectionId,
      label: "Old label",
    }),
    profile: new BearerConnectionProfile({ ...PAIRED_PROFILE, label: "Old label" }),
    credential: new BearerConnectionCredential({ token: "old-token" }),
  });
  yield* registry.register(registration);
  yield* registry.setEnabled(PAIRED_ENVIRONMENT_ID, false);
  yield* registry.setCompatibility(PAIRED_ENVIRONMENT_ID, UNSUPPORTED_ERROR);
  const entries = yield* SubscriptionRef.get(registry.entries);
  expect(entries.get(PAIRED_ENVIRONMENT_ID)).toEqual({
    target: registration.target,
    profile: Option.some(registration.profile),
    enabled: false,
    unsupportedReason: UNSUPPORTED_ERROR.message,
  });
  return entries;
});

describe("connection onboarding", () => {
  it.effect.each(["failed", "stalled"] as const)(
    "pairs through a direct hint when relay setup is %s",
    (mode) =>
      Effect.gen(function* () {
        const calls: Array<Call> = [];
        const entered = Promise.withResolvers<void>();
        const relayEndpoint = `https://${"11".repeat(16)}.${"22".repeat(16)}.relay.supaterm.alt/`;
        const pairingUrl = buildPairingUrl(relayEndpoint, "pairing-token", {
          environmentId: SAVED_ENVIRONMENT_ID,
          routes: [TAILNET],
        });
        const pending = yield* preparePairingRegistration(
          { pairingUrl },
          NO_SAVED_ENVIRONMENTS,
        ).pipe(
          Effect.provide(
            Layer.mergeAll(
              layerClientPresentation,
              layerRoutedHttp(calls, { [TAILNET]: pairingServer() }),
            ),
          ),
          Effect.provideService(RelayGateway, {
            available: true,
            resolve: async (address) => address,
            lease: (address) => ({
              prepare: async () => {
                if (address !== relayEndpoint) return address;
                entered.resolve();
                if (mode === "failed") throw new Error("Relay unavailable");
                return new Promise<string>(() => {});
              },
              retain: () => {},
              close: async () => {},
            }),
            release: async () => {},
            fetch: globalThis.fetch,
          }),
          Effect.forkChild,
        );
        yield* Effect.promise(() => entered.promise);
        if (mode === "stalled") yield* TestClock.adjust(ROUTE_CHECK_TIMEOUT_MS);
        const { registration } = yield* Fiber.join(pending);
        expect(registration.profile.httpBaseUrl).toBe(`${TAILNET}/`);
        expect(urls(calls).filter((url) => url.endsWith("/oauth/token"))).toEqual([
          `${TAILNET}/oauth/token`,
        ]);
      }),
  );

  it.effect.each(["opening", "preparing"] as const)(
    "releases abandoned relay %s when a direct pairing fallback wins",
    (stage) =>
      Effect.gen(function* () {
        const entered = Promise.withResolvers<void>();
        const finishOpen = Promise.withResolvers<void>();
        const closed = Promise.withResolvers<void>();
        let closes = 0;
        const calls: Call[] = [];
        const relayEndpoint = `https://${"11".repeat(16)}.${"22".repeat(16)}.relay.supaterm.alt/`;
        const gatewayLayer = layerRelayGateway({
          fetch: globalThis.fetch,
          open: async () => {
            if (stage === "opening") {
              entered.resolve();
              await finishOpen.promise;
            }
            return {
              prepare: () => {
                entered.resolve();
                return new Promise<string>(() => {});
              },
              close: async () => {
                closes++;
                closed.resolve();
              },
            };
          },
        });
        yield* Effect.gen(function* () {
          const pending = yield* preparePairingRegistration(
            {
              pairingUrl: buildPairingUrl(relayEndpoint, "pairing-token", {
                environmentId: SAVED_ENVIRONMENT_ID,
                routes: [TAILNET],
              }),
            },
            NO_SAVED_ENVIRONMENTS,
          ).pipe(
            Effect.provide(
              Layer.mergeAll(
                layerClientPresentation,
                layerRoutedHttp(calls, { [TAILNET]: pairingServer() }),
              ),
            ),
            Effect.forkChild,
          );
          yield* Effect.promise(() => entered.promise);
          yield* TestClock.adjust(ROUTE_CHECK_TIMEOUT_MS);
          const { registration } = yield* Fiber.join(pending);
          expect(registration.profile.httpBaseUrl).toBe(`${TAILNET}/`);
          finishOpen.resolve();
          yield* Effect.promise(() => closed.promise);
          expect(closes).toBe(1);
        }).pipe(Effect.provide(gatewayLayer));
      }).pipe(Effect.scoped),
  );

  it.effect("times out relay preparation when there is no usable fallback", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = [];
      const entered = Promise.withResolvers<void>();
      const relayEndpoint = `https://${"11".repeat(16)}.${"22".repeat(16)}.relay.supaterm.alt/`;
      const pending = yield* preparePairingRegistration(
        { pairingUrl: buildPairingUrl(relayEndpoint, "pairing-token") },
        NO_SAVED_ENVIRONMENTS,
      ).pipe(
        Effect.provide(Layer.mergeAll(layerClientPresentation, layerRoutedHttp(calls, {}))),
        Effect.provideService(RelayGateway, {
          available: true,
          resolve: async (address) => address,
          lease: () => ({
            prepare: () => {
              entered.resolve();
              return new Promise<string>(() => {});
            },
            retain: () => {},
            close: async () => {},
          }),
          release: async () => {},
          fetch: globalThis.fetch,
        }),
        Effect.result,
        Effect.forkChild,
      );
      yield* Effect.promise(() => entered.promise);
      yield* TestClock.adjust(10_000);
      expect(yield* Fiber.join(pending)).toMatchObject({
        _tag: "Failure",
        failure: { reason: "timeout" },
      });
      expect(calls).toEqual([]);
    }),
  );

  it.effect(
    "pairs an unreachable LAN link through a learned custom relay with a cold gateway",
    () =>
      Effect.gen(function* () {
        const relayEndpoint = `https://${"11".repeat(16)}.${"22".repeat(16)}.relay.supaterm.alt/`;
        const customRelay = "wss://private-relay.example.test";
        const loopback = "http://127.0.0.1:44000";
        const calls: Call[] = [];
        const opened: Array<{ address: string; relayUrl: string }> = [];
        const server = pairingServer();
        const layerGateway = layerRelayGateway({
          open: async (address, relayUrl) => {
            opened.push({ address, relayUrl });
            if (relayUrl !== customRelay) throw new Error("Wrong relay server");
            return { prepare: async () => loopback, close: async () => {} };
          },
          fetch: async (request, init = {}) => {
            const url = new URL(String(request));
            calls.push({ url: url.href, init });
            if (url.origin !== loopback) throw new Error("LAN is unreachable");
            return server(url.pathname, init);
          },
        });
        const lan = savedRoute(LAN, TAILNET_CONNECTION);
        const saved = savedRoute(
          relayEndpoint,
          `learned:${SAVED_ENVIRONMENT_ID}:${relayEndpoint}@${TAILNET_CONNECTION}`,
          true,
        );
        const profile = Option.getOrThrow(saved.profile);
        const relay = {
          ...saved,
          profile: Option.some(new BearerConnectionProfile({ ...profile, relayUrl: customRelay })),
        };
        const { registration } = yield* Effect.gen(function* () {
          const gateway = yield* RelayGateway;
          return yield* preparePairingRegistration(
            { pairingUrl: PAIRING_LINK },
            savedEnvironment(lan, relay),
          ).pipe(
            Effect.provide(
              Layer.mergeAll(layerClientPresentation, RpcHttp.layerRemoteHttpClient(gateway.fetch)),
            ),
          );
        }).pipe(Effect.provide(layerGateway));
        expect(registration.target.environmentId).toBe(SAVED_ENVIRONMENT_ID);
        expect(opened).toEqual([
          { address: relayEndpoint.replace(/\/$/, ""), relayUrl: customRelay },
        ]);
        expect(urls(calls).filter((url) => url.endsWith("/oauth/token"))).toEqual([
          `${loopback}/oauth/token`,
        ]);
      }).pipe(Effect.scoped),
  );

  it.effect("pairs a new device through a link route and saves the reachable address", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = [];
      const { registration } = yield* preparePairingRegistration(
        { pairingUrl: ROUTED_PAIRING_LINK },
        NO_SAVED_ENVIRONMENTS,
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            layerClientPresentation,
            layerRoutedHttp(calls, { [TAILNET]: pairingServer() }),
          ),
        ),
      );
      expect(registration.profile.httpBaseUrl).toBe(`${TAILNET}/`);
      expect(urls(calls).filter((url) => url.endsWith("/oauth/token"))).toEqual([
        `${TAILNET}/oauth/token`,
      ]);
    }),
  );

  it.effect("skips a different server at the LAN address without sending it the token", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = [];
      yield* preparePairingRegistration(
        { pairingUrl: ROUTED_PAIRING_LINK },
        NO_SAVED_ENVIRONMENTS,
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            layerClientPresentation,
            layerRoutedHttp(calls, {
              [LAN]: pairingServer({ environmentId: "other" }),
              [TAILNET]: pairingServer(),
            }),
          ),
        ),
      );
      expect(urls(calls)).not.toContain(`${LAN}/oauth/token`);
      expect(urls(calls)).toContain(`${TAILNET}/oauth/token`);
    }),
  );

  it.effect("does not probe alternatives when the identified link address answers", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = [];
      yield* preparePairingRegistration(
        { pairingUrl: ROUTED_PAIRING_LINK },
        NO_SAVED_ENVIRONMENTS,
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            layerClientPresentation,
            layerRoutedHttp(calls, { [LAN]: pairingServer(), [TAILNET]: pairingServer() }),
          ),
        ),
      );
      expect(urls(calls)).toEqual([
        `${LAN}/.well-known/supaterm/environment`,
        `${LAN}/oauth/token`,
      ]);
    }),
  );

  it.effect("races link routes after the head start even when a saved route hangs", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = [];
      const silenced = yield* Deferred.make<void>();
      const saved = "https://saved.test";
      const fiber = yield* preparePairingRegistration(
        { pairingUrl: ROUTED_PAIRING_LINK },
        savedEnvironment(savedRoute(saved, "saved")),
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            layerClientPresentation,
            layerRoutedHttp(
              calls,
              { [LAN]: "silent", [saved]: "silent", [TAILNET]: pairingServer() },
              silenced,
            ),
          ),
        ),
        Effect.forkChild,
      );
      yield* Deferred.await(silenced);
      expect(urls(calls)).toEqual([`${LAN}/.well-known/supaterm/environment`]);
      yield* TestClock.adjust(ROUTE_CHECK_TIMEOUT_MS);
      const { registration } = yield* Fiber.join(fiber);
      expect(registration.profile.httpBaseUrl).toBe(`${TAILNET}/`);
      expect(calls.find((call) => call.url.startsWith(LAN))?.init.signal?.aborted).toBe(true);
      expect(calls.find((call) => call.url.startsWith(saved))?.init.signal?.aborted).toBe(true);
    }),
  );

  it.effect("uses saved-route provenance when the same origin is in the link", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = [];
      const { registration } = yield* preparePairingRegistration(
        { pairingUrl: ROUTED_PAIRING_LINK },
        PAIRED_OVER_TAILNET,
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            layerClientPresentation,
            layerRoutedHttp(calls, { [TAILNET]: pairingServer() }),
          ),
        ),
      );
      expect(registration.profile.httpBaseUrl).toBe(`${LAN}/`);
      expect(
        urls(calls).filter((url) => url === `${TAILNET}/.well-known/supaterm/environment`),
      ).toHaveLength(1);
    }),
  );

  it.effect("rejects malformed or conflicting identities before requesting any address", () =>
    Effect.gen(function* () {
      for (const input of [
        { pairingUrl: `${PAIRING_LINK}&env=` },
        { pairingUrl: `${PAIRING_LINK}&env=one&env=two` },
        { pairingUrl: ROUTED_PAIRING_LINK, expectedEnvironmentId: EnvironmentId.make("other") },
      ]) {
        const calls: Array<Call> = [];
        const error = yield* preparePairingRegistration(input, NO_SAVED_ENVIRONMENTS).pipe(
          Effect.provide(
            Layer.mergeAll(
              layerClientPresentation,
              layerRoutedHttp(calls, { [LAN]: pairingServer() }),
            ),
          ),
          Effect.flip,
        );
        expect(error).toMatchObject({ reason: "configuration" });
        expect(calls).toEqual([]);
      }
    }),
  );

  it.effect("adds a link-only route without checking or replacing existing credentials", () =>
    Effect.gen(function* () {
      const { calls, token, events } = yield* registerPairing({
        pairingUrl: ROUTED_PAIRING_LINK,
        entries: savedEnvironment(savedRoute(REMOTE, "existing")),
        credentials: [["existing", "saved-admin-token"]],
        servers: { [TAILNET]: pairingServer() },
      });
      expect(token("existing")).toBe("saved-admin-token");
      expect(urls(calls).some((url) => url.endsWith("/api/auth/session"))).toBe(false);
      expect(events).toEqual([`register:bearer:environment-paired:${TAILNET}`]);
    }),
  );

  it.effect("prepares a persisted bearer registration from pairing details", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = [];
      const { registration } = yield* preparePairingRegistration(
        {
          host: "remote.example.test",
          pairingCode: "pairing-token",
        },
        NO_SAVED_ENVIRONMENTS,
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            layerClientPresentation,
            layerRoutedHttp(calls, { [REMOTE]: pairingServer() }),
          ),
        ),
      );

      expect(registration).toMatchObject({
        _tag: "BearerConnectionRegistration",
        target: {
          environmentId: "environment-paired",
          label: "Paired environment",
          connectionId: "bearer:environment-paired:https://remote.example.test",
        },
        profile: {
          environmentId: "environment-paired",
          label: "Paired environment",
          connectionId: "bearer:environment-paired:https://remote.example.test",
          httpBaseUrl: "https://remote.example.test/",
          wsBaseUrl: "wss://remote.example.test/",
        },
        credential: {
          token: "bearer-token",
        },
      });
      expect(calls.map((call) => call.url)).toEqual([
        "https://remote.example.test/.well-known/supaterm/environment",
        "https://remote.example.test/oauth/token",
      ]);

      const tokenRequest = calls.find((call) => call.url.endsWith("/oauth/token"));
      const tokenBody =
        tokenRequest?.init.body instanceof Uint8Array
          ? new TextDecoder().decode(tokenRequest.init.body)
          : String(tokenRequest?.init.body);
      const tokenParams = new URLSearchParams(tokenBody);
      expect(tokenParams.get("subject_token")).toBe("pairing-token");
      expect(tokenParams.has("scope")).toBe(false);
      expect(tokenParams.get("client_label")).toBe("Supaterm Test");
      expect(tokenParams.get("client_device_type")).toBe("desktop");
      expect(tokenParams.get("client_os")).toBe("Test OS");
    }),
  );

  it.effect("turns a switched-off environment back on when it is paired again", () =>
    Effect.gen(function* () {
      const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
      const onboarding = yield* ConnectionOnboarding;
      yield* registerSwitchedOffEnvironment;

      const environmentId = yield* onboarding.registerPairing(PAIRING_INPUT);

      expect(environmentId).toBe(PAIRED_ENVIRONMENT_ID);
      const entries = yield* SubscriptionRef.get(registry.entries);
      const entry = entries.get(environmentId);
      expect(entries.size).toBe(1);
      expect(entry?.enabled).toBe(true);
      expect(entry?.unsupportedReason).toBeUndefined();
      expect(entry?.profile).toEqual(Option.some(PAIRED_PROFILE));
      expect(entry?.target).toEqual(
        new BearerConnectionTarget({
          environmentId,
          connectionId: PAIRED_PROFILE.connectionId,
          label: PAIRED_PROFILE.label,
        }),
      );
    }).pipe(Effect.provide(layerPairingOnboarding())),
  );

  it.effect(
    "re-pairs an outdated self-updatable environment so its connection can be rechecked",
    () =>
      Effect.gen(function* () {
        const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
        const onboarding = yield* ConnectionOnboarding;
        yield* registerSwitchedOffEnvironment;
        yield* registry.setCompatibility(
          PAIRED_ENVIRONMENT_ID,
          new ConnectionBlockedError({
            reason: "unsupported",
            detail: "The saved server needs an update.",
            serverUpdateRequired: true,
          }),
        );
        expect(
          (yield* SubscriptionRef.get(registry.entries)).get(PAIRED_ENVIRONMENT_ID),
        ).toMatchObject({
          enabled: false,
          serverUpdateRequired: true,
        });

        const environmentId = yield* onboarding.registerPairing(PAIRING_INPUT);

        expect(environmentId).toBe(PAIRED_ENVIRONMENT_ID);
        const entry = (yield* SubscriptionRef.get(registry.entries)).get(environmentId);
        expect(entry?.enabled).toBe(true);
        expect(entry?.unsupportedReason).toBeUndefined();
        expect(entry?.serverUpdateRequired).toBeUndefined();
        expect(entry?.profile).toEqual(Option.some(PAIRED_PROFILE));
      }).pipe(
        Effect.provide(
          layerPairingOnboarding({
            protocolVersion: ORCHESTRATION_PROTOCOL_VERSION - 1,
            selfUpdate: true,
          }),
        ),
      ),
  );

  it.effect("registers an enabled environment on first-time pairing", () =>
    Effect.gen(function* () {
      const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
      const onboarding = yield* ConnectionOnboarding;
      expect((yield* SubscriptionRef.get(registry.entries)).size).toBe(0);

      const environmentId = yield* onboarding.registerPairing(PAIRING_INPUT);

      expect(environmentId).toBe(PAIRED_ENVIRONMENT_ID);
      const entries = yield* SubscriptionRef.get(registry.entries);
      const entry = entries.get(environmentId);
      expect(entries.size).toBe(1);
      expect(entry?.enabled).toBe(true);
      expect(entry?.unsupportedReason).toBeUndefined();
      expect(entry?.profile).toEqual(Option.some(PAIRED_PROFILE));
    }).pipe(Effect.provide(layerPairingOnboarding())),
  );

  it.effect("leaves a platform-managed environment untouched when its id is paired", () =>
    Effect.gen(function* () {
      const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
      const onboarding = yield* ConnectionOnboarding;
      yield* registry.registerPlatform(
        new PrimaryConnectionRegistration({
          target: new PrimaryConnectionTarget({
            environmentId: PAIRED_ENVIRONMENT_ID,
            label: "Host environment",
            httpBaseUrl: "http://127.0.0.1:3773",
            wsBaseUrl: "ws://127.0.0.1:3773",
          }),
        }),
      );
      yield* registry.setCompatibility(PAIRED_ENVIRONMENT_ID, UNSUPPORTED_ERROR);
      const before = yield* SubscriptionRef.get(registry.entries);
      expect(before.get(PAIRED_ENVIRONMENT_ID)?.enabled).toBe(false);

      const environmentId = yield* onboarding.registerPairing(PAIRING_INPUT);

      expect(environmentId).toBe(PAIRED_ENVIRONMENT_ID);
      const after = yield* SubscriptionRef.get(registry.entries);
      expect(after).toEqual(before);
      expect(after.get(PAIRED_ENVIRONMENT_ID)?.unsupportedReason).toBe(UNSUPPORTED_ERROR.message);
    }).pipe(Effect.provide(layerPairingOnboarding())),
  );

  it.effect("leaves a switched-off environment unchanged when the pairing exchange fails", () =>
    Effect.gen(function* () {
      const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
      const onboarding = yield* ConnectionOnboarding;
      const before = yield* registerSwitchedOffEnvironment;

      const error = yield* onboarding.registerPairing(PAIRING_INPUT).pipe(Effect.flip);

      expect(error).toMatchObject({
        _tag: "ConnectionBlockedError",
        reason: "authentication",
        traceId: "trace-pairing-test",
      });
      const after = yield* SubscriptionRef.get(registry.entries);
      expect(after).toEqual(before);
      expect(after.get(PAIRED_ENVIRONMENT_ID)?.enabled).toBe(false);
      expect(after.get(PAIRED_ENVIRONMENT_ID)?.unsupportedReason).toBe(UNSUPPORTED_ERROR.message);
    }).pipe(Effect.provide(layerPairingOnboarding({ failExchange: true }))),
  );

  it.effect("rejects an incompatible server without consuming the pairing credential", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = [];
      const error = yield* preparePairingRegistration(
        {
          host: "remote.example.test",
          pairingCode: "pairing-token",
        },
        NO_SAVED_ENVIRONMENTS,
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            layerClientPresentation,
            layerRoutedHttp(calls, {
              [REMOTE]: pairingServer({ protocolVersion: ORCHESTRATION_PROTOCOL_VERSION + 1 }),
            }),
          ),
        ),
        Effect.flip,
      );
      expect(error).toMatchObject({ reason: "unsupported" });
      expect(calls.map((call) => call.url)).toEqual([
        "https://remote.example.test/.well-known/supaterm/environment",
      ]);
    }),
  );
  it.effect.each([
    { label: "read-only", scopes: ["orchestration:read"] },
    { label: "default", scopes: AuthStandardClientScopes },
  ] as const)("preserves the $label grant when pairing a remote environment", ({ scopes }) =>
    Effect.gen(function* () {
      const calls: Array<{ readonly url: string; readonly init: RequestInit }> = [];
      const httpLayer = layerRoutedHttp(calls, {
        [REMOTE]: pairingServer({ grantScopes: scopes }),
      });
      const { registration } = yield* preparePairingRegistration(
        {
          host: "remote.example.test",
          pairingCode: "pairing-token",
        },
        NO_SAVED_ENVIRONMENTS,
      ).pipe(Effect.provide(Layer.mergeAll(layerClientPresentation, httpLayer)));

      const session = yield* fetchRemoteSessionState({
        httpBaseUrl: registration.profile.httpBaseUrl,
        bearerToken: registration.credential.token,
      }).pipe(Effect.provide(httpLayer));

      expect(session.authenticated).toBe(true);
      expect(session.scopes).toEqual(scopes);
    }),
  );

  it.effect("pairs an outdated server so it can be updated from this client", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = [];
      const { registration } = yield* preparePairingRegistration(
        {
          host: "remote.example.test",
          pairingCode: "pairing-token",
        },
        NO_SAVED_ENVIRONMENTS,
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            layerClientPresentation,
            layerRoutedHttp(calls, {
              [REMOTE]: pairingServer({
                protocolVersion: ORCHESTRATION_PROTOCOL_VERSION - 1,
                selfUpdate: true,
              }),
            }),
          ),
        ),
      );
      expect(registration.target.environmentId).toBe("environment-paired");
      expect(calls.map((call) => call.url)).toContain("https://remote.example.test/oauth/token");
    }),
  );

  it.effect("refuses an outdated server that cannot update itself", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = [];
      const error = yield* preparePairingRegistration(
        {
          host: "remote.example.test",
          pairingCode: "pairing-token",
        },
        NO_SAVED_ENVIRONMENTS,
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            layerClientPresentation,
            layerRoutedHttp(calls, {
              [REMOTE]: pairingServer({ protocolVersion: ORCHESTRATION_PROTOCOL_VERSION - 1 }),
            }),
          ),
        ),
        Effect.flip,
      );
      expect(error).toMatchObject({ reason: "unsupported" });
      expect(error).not.toHaveProperty("serverUpdateRequired");
      expect(calls.map((call) => call.url)).toEqual([
        "https://remote.example.test/.well-known/supaterm/environment",
      ]);
    }),
  );

  it.effect("does not consume a pairing credential when descriptor discovery fails", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = [];

      yield* preparePairingRegistration(
        {
          host: "remote.example.test",
          pairingCode: "pairing-token",
        },
        NO_SAVED_ENVIRONMENTS,
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            layerClientPresentation,
            layerRoutedHttp(calls, { [REMOTE]: pairingServer({ failDescriptor: true }) }),
          ),
        ),
        Effect.flip,
      );

      expect(calls.map((call) => call.url)).toEqual([
        "https://remote.example.test/.well-known/supaterm/environment",
      ]);
    }),
  );

  it.effect("rejects invalid pairing details before making a request", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = [];
      const error = yield* preparePairingRegistration(
        { host: "", pairingCode: "" },
        NO_SAVED_ENVIRONMENTS,
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            layerClientPresentation,
            layerRoutedHttp(calls, { [REMOTE]: pairingServer() }),
          ),
        ),
        Effect.flip,
      );

      expect(error).toMatchObject({
        _tag: "ConnectionBlockedError",
        reason: "configuration",
        message: "Enter a backend URL.",
      });
      expect(calls).toEqual([]);
    }),
  );

  it.effect("updates bearer metadata while preserving the credential and identity", () =>
    Effect.gen(function* () {
      const environmentId = EnvironmentId.make("environment-paired");
      const registration = yield* prepareBearerConnectionUpdate({
        input: {
          environmentId,
          label: "  Renamed environment  ",
          httpBaseUrl: "http://100.65.180.100:3773/path",
        },
        entry: Option.some({
          target: new BearerConnectionTarget({
            environmentId,
            label: "Old label",
            connectionId: "bearer:environment-paired:https://remote.example.test",
          }),
          profile: Option.some(
            new BearerConnectionProfile({
              connectionId: "bearer:environment-paired:https://remote.example.test",
              environmentId,
              label: "Old label",
              httpBaseUrl: "http://old.example.test/",
              wsBaseUrl: "ws://old.example.test/",
            }),
          ),
          enabled: true,
        }),
        credential: Option.some(new BearerConnectionCredential({ token: "bearer-token" })),
      });

      expect(registration).toMatchObject({
        target: {
          environmentId,
          label: "Renamed environment",
          connectionId: "bearer:environment-paired:https://remote.example.test",
        },
        profile: {
          environmentId,
          label: "Renamed environment",
          httpBaseUrl: "http://100.65.180.100:3773/",
          wsBaseUrl: "ws://100.65.180.100:3773/",
        },
        credential: { token: "bearer-token" },
      });
    }),
  );

  it.effect("keeps a custom relay when an edit names the relay host by its legacy address", () =>
    Effect.gen(function* () {
      const environmentId = EnvironmentId.make("environment-relay");
      const connectionId = "bearer:environment-relay";
      const relayEndpoint = `https://${"11".repeat(16)}.${"22".repeat(16)}.relay.supaterm.alt/`;
      const relayUrl = "wss://relay.example.test";
      const registration = yield* prepareBearerConnectionUpdate({
        input: {
          environmentId,
          label: "Relay",
          httpBaseUrl: relayEndpoint.replace(".alt/", ".invalid/"),
        },
        entry: Option.some({
          target: new BearerConnectionTarget({ environmentId, label: "Relay", connectionId }),
          profile: Option.some(
            new BearerConnectionProfile({
              connectionId,
              environmentId,
              label: "Relay",
              httpBaseUrl: relayEndpoint,
              wsBaseUrl: relayEndpoint.replace("https:", "wss:"),
              relayUrl,
            }),
          ),
          enabled: true,
        }),
        credential: Option.some(new BearerConnectionCredential({ token: "bearer-token" })),
      });

      expect(registration.profile).toMatchObject({ httpBaseUrl: relayEndpoint, relayUrl });
    }),
  );

  it.effect("prepares an SSH registration from the provisioned platform environment", () =>
    Effect.gen(function* () {
      const target = {
        alias: "devbox",
        hostname: "devbox.example.test",
        username: "developer",
        port: 22,
      };
      const registration = yield* prepareSshRegistration({
        target,
      }).pipe(
        Effect.provideService(
          ClientCapabilities.SshEnvironmentGateway,
          ClientCapabilities.SshEnvironmentGateway.of({
            provision: () =>
              Effect.succeed({
                environmentId: EnvironmentId.make("environment-ssh"),
                label: "Remote development box",
                bootstrap: {
                  target,
                  httpBaseUrl: "http://127.0.0.1:3201",
                  wsBaseUrl: "ws://127.0.0.1:3201",
                  pairingToken: "pairing-token",
                },
                bearerToken: "bearer-token",
              }),
            prepare: () => Effect.die("unused"),
            disconnect: () => Effect.die("unused"),
          }),
        ),
      );

      expect(registration).toMatchObject({
        _tag: "SshConnectionRegistration",
        target: {
          environmentId: "environment-ssh",
          label: "Remote development box",
          connectionId: 'ssh:environment-ssh:["devbox","devbox.example.test","developer",22]',
        },
        profile: {
          environmentId: "environment-ssh",
          label: "Remote development box",
          connectionId: 'ssh:environment-ssh:["devbox","devbox.example.test","developer",22]',
          target,
        },
        // Saved so the first connect reuses this pairing instead of adding another.
        credential: { token: "bearer-token" },
      });
    }),
  );

  it.effect("pairs a saved machine through another route when the link's address fails", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = [];
      const { registration } = yield* preparePairingRegistration(
        { pairingUrl: PAIRING_LINK },
        PAIRED_OVER_TAILNET,
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            layerClientPresentation,
            layerRoutedHttp(calls, { [TAILNET]: pairingServer() }),
          ),
        ),
      );

      expect(registration).toMatchObject({
        target: { connectionId: `bearer:environment-paired:${LAN}` },
        profile: { httpBaseUrl: `${LAN}/`, wsBaseUrl: "ws://192.168.1.10:3773/" },
        credential: { token: "bearer-token" },
      });
      expect(urls(calls).filter((url) => url.endsWith("/oauth/token"))).toEqual([
        `${TAILNET}/oauth/token`,
      ]);
    }),
  );

  it.effect("pairs through another route once the link's address misses the route check", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = [];
      const silenced = yield* Deferred.make<void>();
      const fiber = yield* preparePairingRegistration(
        { pairingUrl: PAIRING_LINK },
        PAIRED_OVER_TAILNET,
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            layerClientPresentation,
            layerRoutedHttp(calls, { [LAN]: "silent", [TAILNET]: pairingServer() }, silenced),
          ),
        ),
        Effect.forkChild,
      );
      yield* Deferred.await(silenced);
      expect(urls(calls)).toEqual([`${LAN}/.well-known/supaterm/environment`]);

      yield* TestClock.adjust(ROUTE_CHECK_TIMEOUT_MS);
      yield* Fiber.join(fiber);
      expect(urls(calls)).toContain(`${TAILNET}/oauth/token`);
      expect(calls[0]?.init.signal?.aborted).toBe(true);
    }),
  );

  it.effect("pairs on the link's address when it answers", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = [];
      yield* preparePairingRegistration({ pairingUrl: PAIRING_LINK }, PAIRED_OVER_TAILNET).pipe(
        Effect.provide(
          Layer.mergeAll(
            layerClientPresentation,
            layerRoutedHttp(calls, { [LAN]: pairingServer(), [TAILNET]: pairingServer() }),
          ),
        ),
      );

      expect(urls(calls)).toEqual([
        `${LAN}/.well-known/supaterm/environment`,
        `${LAN}/oauth/token`,
      ]);
    }),
  );

  it.effect("reports the link's own error when no saved route answers as that machine", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = [];
      const error = yield* preparePairingRegistration(
        { pairingUrl: PAIRING_LINK },
        PAIRED_OVER_TAILNET,
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            layerClientPresentation,
            layerRoutedHttp(calls, {
              [TAILNET]: pairingServer({ environmentId: "environment-other" }),
            }),
          ),
        ),
        Effect.flip,
      );

      expect(error).toMatchObject({ _tag: "ConnectionTransientError", reason: "network" });
      expect(urls(calls).filter((url) => url.endsWith("/oauth/token"))).toEqual([]);
    }),
  );

  it.effect("re-pairing an address saved under an older id keeps that route", () =>
    Effect.gen(function* () {
      const { registration } = yield* preparePairingRegistration(
        { pairingUrl: PAIRING_LINK },
        savedEnvironment(
          savedRoute(LAN, "bearer:environment-paired"),
          savedRoute(
            TAILNET,
            `learned:environment-paired:${TAILNET}@bearer:environment-paired`,
            true,
          ),
        ),
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            layerClientPresentation,
            layerRoutedHttp([], { [TAILNET]: pairingServer() }),
          ),
        ),
      );

      expect(registration.target.connectionId).toBe("bearer:environment-paired");
    }),
  );

  it.effect("re-pairing over another route renews its revoked credential before reconnecting", () =>
    Effect.gen(function* () {
      const { events, token } = yield* registerPairing({
        pairingUrl: PAIRING_LINK,
        entries: PAIRED_OVER_TAILNET,
        credentials: [[TAILNET_CONNECTION, "revoked-token"]],
        servers: { [TAILNET]: pairingServer({ acceptedTokens: ["bearer-token"] }) },
      });

      expect(events).toEqual([
        `put:${TAILNET_CONNECTION}`,
        `register:bearer:environment-paired:${LAN}`,
      ]);
      expect(token(TAILNET_CONNECTION)).toBe("bearer-token");
    }),
  );

  it.effect("re-pairing keeps a credential the server still accepts", () =>
    Effect.gen(function* () {
      const { events, token } = yield* registerPairing({
        pairingUrl: PAIRING_LINK,
        entries: PAIRED_OVER_TAILNET,
        credentials: [[TAILNET_CONNECTION, "admin-token"]],
        servers: { [TAILNET]: pairingServer({ acceptedTokens: ["admin-token"] }) },
      });

      expect(events).toEqual([`register:bearer:environment-paired:${LAN}`]);
      expect(token(TAILNET_CONNECTION)).toBe("admin-token");
    }),
  );

  it.effect("re-pairing keeps a credential it could not check", () =>
    Effect.gen(function* () {
      const { token } = yield* registerPairing({
        pairingUrl: PAIRING_LINK,
        entries: PAIRED_OVER_TAILNET,
        credentials: [[TAILNET_CONNECTION, "admin-token"]],
        servers: { [TAILNET]: pairingServer({ failSession: true }) },
      });

      expect(token(TAILNET_CONNECTION)).toBe("admin-token");
    }),
  );

  it.effect("re-pairing gives a reached route with no credential the new one", () =>
    Effect.gen(function* () {
      const { token } = yield* registerPairing({
        pairingUrl: PAIRING_LINK,
        entries: PAIRED_OVER_TAILNET,
        credentials: [],
        servers: { [TAILNET]: pairingServer() },
      });

      expect(token(TAILNET_CONNECTION)).toBe("bearer-token");
    }),
  );

  it.effect("never sends saved credentials to a link address that is not a saved route", () =>
    Effect.gen(function* () {
      const impostor = "http://203.0.113.9:3773";
      const { calls, token } = yield* registerPairing({
        pairingUrl: `${impostor}/#token=pairing-token`,
        entries: PAIRED_OVER_TAILNET,
        credentials: [[TAILNET_CONNECTION, "saved-token"]],
        servers: { [impostor]: pairingServer() },
      });

      expect(calls.map((call) => bearerToken(call.init))).not.toContain("saved-token");
      expect(token(TAILNET_CONNECTION)).toBe("saved-token");
    }),
  );
});
