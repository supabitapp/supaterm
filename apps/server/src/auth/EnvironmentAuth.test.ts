import * as NodeServices from "@effect/platform-node/NodeServices";
import { authScopeResponse, AuthStandardClientScopes } from "@supaterm/contracts";
import { expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Clock from "effect/Clock";
import { currentDesktopBootstrapToken } from "@supaterm/shared/desktopBootstrapToken";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as TestClock from "effect/testing/TestClock";
import * as Headers from "effect/http/Headers";

import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as EnvironmentAuth from "./EnvironmentAuth.ts";

import * as ServerSecretStore from "./ServerSecretStore.ts";
import * as SessionStore from "./SessionStore.ts";

const TEST_SERVER_PORT = 13_773;

const layerServerConfig = (overrides?: Partial<ServerConfig.ServerConfig["Service"]>) =>
  Layer.effect(
    ServerConfig.ServerConfig,
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      return {
        ...config,
        ...overrides,
        port: TEST_SERVER_PORT,
      } satisfies ServerConfig.ServerConfig["Service"];
    }),
  ).pipe(
    Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "supaterm-auth-server-test-" })),
  );

const layerEnvironmentAuth = (overrides?: Partial<ServerConfig.ServerConfig["Service"]>) =>
  EnvironmentAuth.layer.pipe(
    Layer.provideMerge(SqlitePersistence.layerMemory),
    Layer.provide(ServerSecretStore.layer),
    Layer.provide(ServerEnvironment.layerIdentity),
    Layer.provide(layerServerConfig(overrides)),
  );

const makeCookieRequest = (
  cookieName: string,
  sessionToken: string,
): Parameters<EnvironmentAuth.EnvironmentAuth["Service"]["authenticateHttpRequest"]>[0] =>
  ({
    cookies: {
      [cookieName]: sessionToken,
    },
    headers: {},
  }) as unknown as Parameters<
    EnvironmentAuth.EnvironmentAuth["Service"]["authenticateHttpRequest"]
  >[0];

const makeBearerRequest = (
  token: string,
): Parameters<EnvironmentAuth.EnvironmentAuth["Service"]["authenticateHttpRequest"]>[0] =>
  ({
    cookies: {},
    headers: {
      authorization: `Bearer ${token}`,
    },
  }) as unknown as Parameters<
    EnvironmentAuth.EnvironmentAuth["Service"]["authenticateHttpRequest"]
  >[0];

const requestMetadata = {
  deviceType: "desktop" as const,
  os: "macOS",
  browser: "Chrome",
  ipAddress: "192.168.1.23",
};

const makeBindMigration = Effect.gen(function* () {
  const dependencies = yield* Layer.build(
    Layer.mergeAll(
      SqlitePersistence.layerMemory,
      ServerSecretStore.layer,
      ServerEnvironment.layerIdentity,
    ).pipe(
      Layer.provideMerge(layerServerConfig({ mode: "web", host: "127.0.0.1", devUrl: undefined })),
    ),
  );
  const original = yield* Layer.build(
    EnvironmentAuth.layer.pipe(Layer.provideMerge(Layer.succeedContext(dependencies))),
  );
  const config = Context.get(dependencies, ServerConfig.ServerConfig);
  const migrated = yield* Layer.build(
    EnvironmentAuth.layer.pipe(
      Layer.provideMerge(
        Layer.succeedContext(
          Context.add(dependencies, ServerConfig.ServerConfig, { ...config, host: "0.0.0.0" }),
        ),
      ),
    ),
  );
  return {
    originalAuth: Context.get(original, EnvironmentAuth.EnvironmentAuth),
    originalSessions: Context.get(original, SessionStore.SessionStore),
    migratedAuth: Context.get(migrated, EnvironmentAuth.EnvironmentAuth),
    migratedSessions: Context.get(migrated, SessionStore.SessionStore),
  };
});

it.layer(NodeServices.layer)("EnvironmentAuth.layer", (it) => {
  it.effect(
    "keeps browser sessions authenticated after the listener moves from loopback to LAN",
    () =>
      Effect.gen(function* () {
        const { originalAuth, originalSessions, migratedAuth, migratedSessions } =
          yield* makeBindMigration;
        const pairing = yield* originalAuth.issuePairingCredential({
          scopes: ["orchestration:read"],
        });
        const exchanged = yield* originalAuth.createBrowserSession(
          pairing.credential,
          requestMetadata,
        );
        const original = yield* originalSessions.verify(exchanged.sessionToken);
        expect(migratedSessions.cookieName).not.toBe(originalSessions.cookieName);
        const request = {
          ...makeCookieRequest(originalSessions.cookieName, exchanged.sessionToken),
          url: "/ws",
          headers: Headers.fromInput({
            host: `localhost:${TEST_SERVER_PORT}`,
            origin: `http://localhost:${TEST_SERVER_PORT}`,
          }),
        };

        for (const authenticate of [
          migratedAuth.authenticateHttpRequest,
          migratedAuth.authenticateWebSocketUpgrade,
        ]) {
          const authenticated = yield* authenticate(request);
          expect(authenticated.sessionId).toBe(original.sessionId);
          expect(authenticated.scopes).toEqual(["orchestration:read"]);
        }
        expect((yield* migratedAuth.getSessionState(request)).authenticated).toBe(true);
        expect((yield* migratedSessions.listActive()).map((session) => session.sessionId)).toEqual([
          original.sessionId,
        ]);
      }),
  );

  it.effect("validates migrated cookies against signatures, expiry and revocation", () =>
    Effect.gen(function* () {
      const { originalSessions, migratedAuth } = yield* makeBindMigration;
      const revoked = yield* originalSessions.issue({ method: "browser-session-cookie" });
      const expired = yield* originalSessions.issue({
        method: "browser-session-cookie",
        ttl: Duration.seconds(1),
      });
      const foreign = yield* Effect.gen(function* () {
        const sessions = yield* SessionStore.SessionStore;
        return yield* sessions.issue({ method: "browser-session-cookie" });
      }).pipe(Effect.provide(layerEnvironmentAuth({ mode: "web", devUrl: undefined })));
      yield* originalSessions.revoke(revoked.sessionId);
      yield* TestClock.adjust(Duration.seconds(2));

      for (const token of [
        revoked.token,
        expired.token,
        foreign.token,
        `${revoked.token}invalid`,
      ]) {
        const error = yield* Effect.flip(
          migratedAuth.authenticateHttpRequest(
            makeCookieRequest(originalSessions.cookieName, token),
          ),
        );
        expect(error._tag).toBe("ServerAuthInvalidCredentialError");
      }
    }),
  );

  it.effect(
    "keeps current cookies and explicit credentials authoritative during bind migration",
    () =>
      Effect.gen(function* () {
        const { originalSessions, migratedAuth, migratedSessions } = yield* makeBindMigration;
        const previous = yield* originalSessions.issue({ method: "browser-session-cookie" });
        const current = yield* migratedSessions.issue({
          method: "browser-session-cookie",
          scopes: ["orchestration:read"],
        });
        const bearer = yield* migratedSessions.issue({ method: "bearer-access-token" });
        const previousRequest = makeCookieRequest(originalSessions.cookieName, previous.token);
        const bothCookies = {
          ...previousRequest,
          cookies: { ...previousRequest.cookies, [migratedSessions.cookieName]: current.token },
        };
        expect((yield* migratedAuth.authenticateHttpRequest(bothCookies)).sessionId).toBe(
          current.sessionId,
        );
        expect(
          (yield* migratedAuth.authenticateHttpRequest({
            ...previousRequest,
            headers: Headers.fromInput({ authorization: `Bearer ${bearer.token}` }),
          })).sessionId,
        ).toBe(bearer.sessionId);

        for (const request of [
          {
            ...bothCookies,
            cookies: { ...bothCookies.cookies, [migratedSessions.cookieName]: "invalid" },
            headers: Headers.fromInput({ authorization: `Bearer ${bearer.token}` }),
          },
          ...["Bearer invalid", "", "Basic invalid"].map((authorization) => ({
            ...previousRequest,
            headers: Headers.fromInput({ authorization }),
          })),
        ]) {
          const error = yield* Effect.flip(migratedAuth.authenticateHttpRequest(request));
          expect(EnvironmentAuth.isServerAuthCredentialError(error)).toBe(true);
        }
      }),
  );

  it.effect("limits bind migration to the exact old cookie and the app's own origins", () =>
    Effect.gen(function* () {
      const { originalSessions, migratedAuth } = yield* makeBindMigration;
      const session = yield* originalSessions.issue({ method: "browser-session-cookie" });
      for (const cookieName of [
        "supaterm_session",
        originalSessions.cookieName.replace(`_${TEST_SERVER_PORT}_`, `_${TEST_SERVER_PORT + 1}_`),
        `supaterm_session_${TEST_SERVER_PORT}_other-environment`,
      ]) {
        const error = yield* Effect.flip(
          migratedAuth.authenticateHttpRequest(makeCookieRequest(cookieName, session.token)),
        );
        expect(error._tag).toBe("ServerAuthMissingCredentialError");
      }
      for (const authenticate of [
        migratedAuth.authenticateHttpRequest,
        migratedAuth.authenticateWebSocketUpgrade,
      ]) {
        const error = yield* Effect.flip(
          authenticate({
            ...makeCookieRequest(originalSessions.cookieName, session.token),
            url: "/ws",
            headers: Headers.fromInput({
              host: `localhost:${TEST_SERVER_PORT}`,
              origin: "http://localhost:8080",
            }),
          }),
        );
        expect(error._tag).toBe("ServerAuthInvalidCredentialError");
      }
    }),
  );

  it.effect("uses the reusable dev cookie without overriding a normal scoped cookie", () =>
    Effect.gen(function* () {
      const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
      const sessions = yield* SessionStore.SessionStore;
      const token = "reusable-dev-auth-token-that-is-long-enough";
      const devExchange = yield* serverAuth.createBrowserSession(token, requestMetadata);
      const pairing = yield* serverAuth.issuePairingCredential({ scopes: ["orchestration:read"] });
      const scopedExchange = yield* serverAuth.createBrowserSession(
        pairing.credential,
        requestMetadata,
      );
      const request = {
        cookies: {
          [sessions.cookieName]: scopedExchange.sessionToken,
          [devExchange.cookieName ?? "missing"]: devExchange.sessionToken,
        },
        headers: {},
      } as unknown as Parameters<
        EnvironmentAuth.EnvironmentAuth["Service"]["authenticateHttpRequest"]
      >[0];

      const authenticated = yield* serverAuth.authenticateHttpRequest(request);
      expect(devExchange.cookieName).toMatch(/^supaterm_dev_session_/);
      expect(devExchange.expireNormalCookie).toBe(true);
      expect(devExchange.response).toMatchObject(authScopeResponse(AuthStandardClientScopes));
      expect(authenticated.scopes).toEqual(["orchestration:read"]);
    }).pipe(
      Effect.provide(
        layerEnvironmentAuth({
          mode: "web",
          devUrl: new URL("http://127.0.0.1:5173"),
          devAuthToken: Redacted.make("reusable-dev-auth-token-that-is-long-enough"),
        }),
      ),
    ),
  );

  it.effect("does not fall back to the dev cookie after a normal cookie is rejected", () =>
    Effect.gen(function* () {
      const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
      const sessions = yield* SessionStore.SessionStore;
      const token = "reusable-dev-auth-token-that-is-long-enough";
      const devExchange = yield* serverAuth.createBrowserSession(token, requestMetadata);
      const pairing = yield* serverAuth.issuePairingCredential({ scopes: ["orchestration:read"] });
      const scopedExchange = yield* serverAuth.createBrowserSession(
        pairing.credential,
        requestMetadata,
      );
      const scoped = yield* sessions.verify(scopedExchange.sessionToken);
      yield* sessions.revoke(scoped.sessionId);
      const request = {
        cookies: {
          [sessions.cookieName]: scopedExchange.sessionToken,
          [devExchange.cookieName ?? "missing"]: devExchange.sessionToken,
        },
        headers: {},
      } as unknown as Parameters<
        EnvironmentAuth.EnvironmentAuth["Service"]["authenticateHttpRequest"]
      >[0];

      const error = yield* Effect.flip(serverAuth.authenticateHttpRequest(request));
      expect(error._tag).toBe("ServerAuthInvalidCredentialError");
    }).pipe(
      Effect.provide(
        layerEnvironmentAuth({
          mode: "web",
          devUrl: new URL("http://127.0.0.1:5173"),
          devAuthToken: Redacted.make("reusable-dev-auth-token-that-is-long-enough"),
        }),
      ),
    ),
  );

  it.effect("does not use the dev cookie when Authorization is invalid or empty", () =>
    Effect.gen(function* () {
      const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
      const token = "reusable-dev-auth-token-that-is-long-enough";
      const devExchange = yield* serverAuth.createBrowserSession(token, requestMetadata);
      for (const authorization of ["Bearer invalid", ""] as const) {
        const request = {
          cookies: { [devExchange.cookieName ?? "missing"]: devExchange.sessionToken },
          headers: { authorization },
        } as unknown as Parameters<
          EnvironmentAuth.EnvironmentAuth["Service"]["authenticateHttpRequest"]
        >[0];
        const error = yield* Effect.flip(serverAuth.authenticateHttpRequest(request));
        expect(EnvironmentAuth.isServerAuthCredentialError(error)).toBe(true);
      }
    }).pipe(
      Effect.provide(
        layerEnvironmentAuth({
          mode: "web",
          devUrl: new URL("http://127.0.0.1:5173"),
          devAuthToken: Redacted.make("reusable-dev-auth-token-that-is-long-enough"),
        }),
      ),
    ),
  );

  it.effect("exchanges the reusable dev token for a local scoped OAuth session", () =>
    Effect.gen(function* () {
      const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
      const sessions = yield* SessionStore.SessionStore;
      const token = "reusable-dev-auth-token-that-is-long-enough";
      const exchanged = yield* serverAuth.exchangeBootstrapCredentialForAccessToken(
        token,
        ["orchestration:read"],
        requestMetadata,
      );

      expect(exchanged.access_token).not.toBe(token);
      expect(exchanged.scope).toBe("orchestration:read");
      expect(exchanged.token_type).toBe("Bearer");

      const secondBearer = yield* serverAuth.exchangeBootstrapCredentialForAccessToken(
        token,
        ["orchestration:read"],
        requestMetadata,
      );
      const firstSession = yield* serverAuth.authenticateHttpRequest(
        makeBearerRequest(exchanged.access_token),
      );
      const secondSession = yield* serverAuth.authenticateHttpRequest(
        makeBearerRequest(secondBearer.access_token),
      );
      expect(firstSession.subject).toBe("reusable-dev-token-child");
      expect(secondSession.subject).toBe("reusable-dev-token-child");
      expect((yield* sessions.verify(token)).subject).toBe("reusable-dev-token");
      const before = yield* serverAuth.listClientSessions(firstSession.sessionId);
      const empty = yield* serverAuth
        .exchangeBootstrapCredentialForAccessToken(token, [], requestMetadata)
        .pipe(Effect.flip);
      expect(empty._tag).toBe("ServerAuthScopeNotGrantedError");
      expect(yield* serverAuth.listClientSessions(firstSession.sessionId)).toEqual(before);
    }).pipe(
      Effect.provide(
        layerEnvironmentAuth({
          mode: "web",
          devUrl: new URL("http://127.0.0.1:5173"),
          devAuthToken: Redacted.make("reusable-dev-auth-token-that-is-long-enough"),
        }),
      ),
    ),
  );

  it.effect("uses a one-time startup credential after local dev token revocation", () =>
    Effect.gen(function* () {
      const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
      const sessions = yield* SessionStore.SessionStore;
      const token = "reusable-dev-auth-token-that-is-long-enough";
      const initial = yield* serverAuth.issueStartupPairingCredential();
      const seeded = yield* sessions.verify(token);

      yield* sessions.revoke(seeded.sessionId);
      const recovery = yield* serverAuth.issueStartupPairingCredential();

      expect(initial.credential).toBe(token);
      expect(recovery.credential).not.toBe(token);
      expect((yield* Effect.flip(sessions.verify(token)))._tag).toBe("SessionTokenRevokedError");
      expect(
        (yield* serverAuth.createBrowserSession(recovery.credential, requestMetadata)).response,
      ).toMatchObject({ authenticated: true, ...authScopeResponse(AuthStandardClientScopes) });
    }).pipe(
      Effect.provide(
        layerEnvironmentAuth({
          mode: "web",
          devUrl: new URL("http://127.0.0.1:5173"),
          devAuthToken: Redacted.make("reusable-dev-auth-token-that-is-long-enough"),
        }),
      ),
    ),
  );

  it.effect("issues standard pairing credentials by default", () =>
    Effect.gen(function* () {
      const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
      const sessions = yield* SessionStore.SessionStore;

      const pairingCredential = yield* serverAuth.issuePairingCredential();
      const exchanged = yield* serverAuth.createBrowserSession(
        pairingCredential.credential,
        requestMetadata,
      );
      const verified = yield* serverAuth.authenticateHttpRequest(
        makeCookieRequest(sessions.cookieName, exchanged.sessionToken),
      );

      expect(verified.sessionId.length).toBeGreaterThan(0);
      expect(verified.scopes).toEqual(AuthStandardClientScopes);
      expect(verified.subject).toBe(`pairing-link:${pairingCredential.id}`);
      expect(pairingCredential.subject).toBe(verified.subject);
    }).pipe(Effect.provide(layerEnvironmentAuth())),
  );

  it.effect("identifies the connected device by its pairing link even when labels match", () =>
    Effect.gen(function* () {
      const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
      const sessions = yield* SessionStore.SessionStore;
      const first = yield* serverAuth.issuePairingCredential({ label: "Phone" });
      const second = yield* serverAuth.issuePairingCredential({ label: "Phone" });
      const exchanged = yield* serverAuth.exchangeBootstrapCredentialForAccessToken(
        second.credential,
        undefined,
        requestMetadata,
      );
      const session = yield* serverAuth.authenticateHttpRequest(
        makeBearerRequest(exchanged.access_token),
      );

      expect(first.subject).not.toBe(second.subject);
      expect(session.subject).toBe(second.subject);
      expect((yield* serverAuth.listSessions())[0]?.connected).toBe(false);

      yield* sessions.markConnected(session.sessionId);
      const connected = (yield* serverAuth.listSessions()).filter((client) => client.connected);
      expect(connected.map((client) => client.subject)).toEqual([second.subject]);
      expect(connected.some((client) => client.subject === first.subject)).toBe(false);

      yield* serverAuth.revokePairingLink(first.id);
      expect((yield* serverAuth.listSessions()).map((client) => client.subject)).toEqual([
        second.subject,
      ]);
    }).pipe(Effect.provide(layerEnvironmentAuth())),
  );

  it.effect("preserves pairing grants after rejecting scopes they do not grant", () =>
    Effect.gen(function* () {
      const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
      const pairingCredential = yield* serverAuth.issuePairingCredential({
        scopes: ["orchestration:read", "orchestration:operate"],
      });

      const error = yield* serverAuth
        .exchangeBootstrapCredentialForAccessToken(
          pairingCredential.credential,
          ["access:write"],
          requestMetadata,
        )
        .pipe(Effect.flip);

      expect(error._tag).toBe("ServerAuthScopeNotGrantedError");
      expect((yield* serverAuth.listPairingLinks()).map((link) => link.id)).toContain(
        pairingCredential.id,
      );
      expect(yield* serverAuth.listSessions()).toEqual([]);

      const token = yield* serverAuth.exchangeBootstrapCredentialForAccessToken(
        pairingCredential.credential,
        ["orchestration:read"],
        requestMetadata,
      );
      const session = yield* serverAuth.authenticateHttpRequest(
        makeBearerRequest(token.access_token),
      );

      expect(token.scope).toBe("orchestration:read");
      expect(session.scopes).toEqual(["orchestration:read"]);
      expect((yield* serverAuth.listPairingLinks()).map((link) => link.id)).not.toContain(
        pairingCredential.id,
      );
      const reused = yield* serverAuth
        .exchangeBootstrapCredentialForAccessToken(
          pairingCredential.credential,
          ["orchestration:read"],
          requestMetadata,
        )
        .pipe(Effect.flip);
      expect(reused._tag).toBe("ServerAuthInvalidCredentialError");
    }).pipe(Effect.provide(layerEnvironmentAuth())),
  );

  it.effect.each([
    { label: "omits scope", requestedScopes: undefined },
    {
      label: "requests unsupported permissions alongside a granted one",
      requestedScopes: ["orchestration:read", "access:write"] as const,
    },
  ])("inherits a constrained pairing grant when token exchange $label", ({ requestedScopes }) =>
    Effect.gen(function* () {
      const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
      const pairingCredential = yield* serverAuth.issuePairingCredential({
        scopes: ["orchestration:read"],
      });

      const token = yield* serverAuth.exchangeBootstrapCredentialForAccessToken(
        pairingCredential.credential,
        requestedScopes,
        requestMetadata,
      );

      expect(token.scope).toBe("orchestration:read");
    }).pipe(Effect.provide(layerEnvironmentAuth())),
  );

  it.effect("narrows rotating desktop grants to the requested scopes", () =>
    Effect.gen(function* () {
      const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
      const token = yield* serverAuth.exchangeBootstrapCredentialForAccessToken(
        currentDesktopBootstrapToken("desktop-secret", yield* Clock.currentTimeMillis),
        ["orchestration:read"],
        requestMetadata,
      );
      const session = yield* serverAuth.authenticateHttpRequest(
        makeBearerRequest(token.access_token),
      );

      expect(token.scope).toBe("orchestration:read");
      expect(session.scopes).toEqual(["orchestration:read"]);
    }).pipe(Effect.provide(layerEnvironmentAuth({ desktopBootstrapSecret: "desktop-secret" }))),
  );

  it.effect("rotates desktop bearer sessions without accumulating authorized clients", () =>
    Effect.gen(function* () {
      const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
      const sessions = yield* SessionStore.SessionStore;
      const browser = yield* serverAuth.createBrowserSession(
        currentDesktopBootstrapToken("desktop-secret", yield* Clock.currentTimeMillis),
        requestMetadata,
      );
      const browserSession = yield* serverAuth.authenticateHttpRequest(
        makeCookieRequest(sessions.cookieName, browser.sessionToken),
      );
      const staleSessions = yield* Effect.forEach([1, 2, 3], () =>
        sessions.issue({ subject: "desktop-bootstrap", method: "bearer-access-token" }),
      );
      const pairing = yield* serverAuth.issuePairingCredential();
      const paired = yield* serverAuth.exchangeBootstrapCredentialForAccessToken(
        pairing.credential,
        undefined,
        { ...requestMetadata, label: "Supaterm Desktop" },
      );
      const first = yield* serverAuth.exchangeBootstrapCredentialForAccessToken(
        currentDesktopBootstrapToken("desktop-secret", yield* Clock.currentTimeMillis),
        undefined,
        requestMetadata,
      );
      const firstSession = yield* serverAuth.authenticateHttpRequest(
        makeBearerRequest(first.access_token),
      );
      const second = yield* serverAuth.exchangeBootstrapCredentialForAccessToken(
        currentDesktopBootstrapToken("desktop-secret", yield* Clock.currentTimeMillis),
        undefined,
        requestMetadata,
      );

      const active = yield* serverAuth.listSessions();
      const firstError = yield* serverAuth
        .authenticateHttpRequest(makeBearerRequest(first.access_token))
        .pipe(Effect.flip);
      const secondSession = yield* serverAuth.authenticateHttpRequest(
        makeBearerRequest(second.access_token),
      );

      expect(active).toHaveLength(3);
      expect(active.map((entry) => entry.sessionId)).toContain(browserSession.sessionId);
      expect(active.map((entry) => entry.sessionId)).toContain(secondSession.sessionId);
      expect(active.map((entry) => entry.sessionId)).not.toContain(firstSession.sessionId);
      expect(firstError._tag).toBe("ServerAuthInvalidCredentialError");
      for (const stale of staleSessions) {
        const error = yield* sessions.verify(stale.token).pipe(Effect.flip);
        expect(error._tag).toBe("SessionTokenRevokedError");
      }
      const pairedSession = yield* serverAuth.authenticateHttpRequest(
        makeBearerRequest(paired.access_token),
      );
      expect(pairedSession.subject).toBe(pairing.subject);
      expect(active.map((entry) => entry.sessionId)).toContain(pairedSession.sessionId);
    }).pipe(
      Effect.provide(
        layerEnvironmentAuth({
          desktopBootstrapSecret: "desktop-secret",
        }),
      ),
    ),
  );

  it.effect("keeps user-issued administrative pairing links manageable", () =>
    Effect.gen(function* () {
      const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
      const pairingCredential = yield* serverAuth.issuePairingCredential({
        scopes: AuthStandardClientScopes,
      });
      const listedPairingLinks = yield* serverAuth.listPairingLinks();

      expect(
        listedPairingLinks.find((pairingLink) => pairingLink.id === pairingCredential.id)?.subject,
      ).toBe(pairingCredential.subject);
    }).pipe(Effect.provide(layerEnvironmentAuth())),
  );

  it.effect("issues startup pairing URLs that bootstrap administrative sessions", () =>
    Effect.gen(function* () {
      const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
      const sessions = yield* SessionStore.SessionStore;

      const pairingUrl = yield* serverAuth.issueStartupPairingUrl("http://127.0.0.1:3773", [
        "https://machine.ts.net",
        "http://100.64.1.2:3773",
      ]);
      const hash = new URLSearchParams(new URL(pairingUrl).hash.slice(1));
      expect(hash.get("env")).toBeTruthy();
      expect(hash.get("routes")).toBe("https://machine.ts.net,http://100.64.1.2:3773");
      const token = new URLSearchParams(new URL(pairingUrl).hash.slice(1)).get("token");
      const listedPairingLinks = yield* serverAuth.listPairingLinks();
      expect(token).toBeTruthy();
      expect(
        listedPairingLinks.some(
          (pairingLink) => pairingLink.subject === "administrative-bootstrap",
        ),
      ).toBe(false);

      const exchanged = yield* serverAuth.createBrowserSession(token ?? "", requestMetadata);
      const verified = yield* serverAuth.authenticateHttpRequest(
        makeCookieRequest(sessions.cookieName, exchanged.sessionToken),
      );

      expect(verified.scopes).toEqual(AuthStandardClientScopes);
      expect(verified.subject).toBe("administrative-bootstrap");
    }).pipe(Effect.provide(layerEnvironmentAuth())),
  );

  it.effect(
    "lists pairing links and revokes other sessions while keeping the administrative session",
    () =>
      Effect.gen(function* () {
        const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
        const sessions = yield* SessionStore.SessionStore;

        const administrativeExchange = yield* serverAuth.createBrowserSession(
          currentDesktopBootstrapToken("desktop-secret", yield* Clock.currentTimeMillis),
          requestMetadata,
        );
        const administrativeSession = yield* serverAuth.authenticateHttpRequest(
          makeCookieRequest(sessions.cookieName, administrativeExchange.sessionToken),
        );
        const pairingCredential = yield* serverAuth.issuePairingCredential({
          label: "Julius iPhone",
        });
        const listedPairingLinks = yield* serverAuth.listPairingLinks();
        const clientExchange = yield* serverAuth.createBrowserSession(
          pairingCredential.credential,
          {
            ...requestMetadata,
            deviceType: "mobile",
            os: "iOS",
            browser: "Safari",
            ipAddress: "192.168.1.88",
          },
        );
        const clientSession = yield* serverAuth.authenticateHttpRequest(
          makeCookieRequest(sessions.cookieName, clientExchange.sessionToken),
        );
        const clientsBeforeRevoke = yield* serverAuth.listClientSessions(
          administrativeSession.sessionId,
        );
        const revokedCount = yield* serverAuth.revokeOtherClientSessions(
          administrativeSession.sessionId,
        );
        const clientsAfterRevoke = yield* serverAuth.listClientSessions(
          administrativeSession.sessionId,
        );

        expect(listedPairingLinks.map((entry) => entry.id)).toContain(pairingCredential.id);
        expect(listedPairingLinks.find((entry) => entry.id === pairingCredential.id)?.label).toBe(
          "Julius iPhone",
        );
        expect(clientsBeforeRevoke).toHaveLength(2);
        expect(
          clientsBeforeRevoke.find((entry) => entry.sessionId === administrativeSession.sessionId)
            ?.current,
        ).toBe(true);
        expect(
          clientsBeforeRevoke.find((entry) => entry.sessionId === clientSession.sessionId)?.current,
        ).toBe(false);
        expect(
          clientsBeforeRevoke.find((entry) => entry.sessionId === clientSession.sessionId)?.client
            .label,
        ).toBe("Julius iPhone");
        expect(
          clientsBeforeRevoke.find((entry) => entry.sessionId === clientSession.sessionId)?.client
            .deviceType,
        ).toBe("mobile");
        expect(revokedCount).toBe(1);
        expect(clientsAfterRevoke).toHaveLength(1);
        expect(clientsAfterRevoke[0]?.sessionId).toBe(administrativeSession.sessionId);
      }).pipe(
        Effect.provide(
          layerEnvironmentAuth({
            desktopBootstrapSecret: "desktop-secret",
          }),
        ),
      ),
  );

  it.effect("accepts cookie sessions on socket upgrades only from the app's own origins", () =>
    Effect.gen(function* () {
      const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
      const sessions = yield* SessionStore.SessionStore;
      const pairing = yield* serverAuth.issuePairingCredential();
      const exchanged = yield* serverAuth.createBrowserSession(pairing.credential, requestMetadata);
      const upgrade = (headers: Record<string, string>) =>
        serverAuth.authenticateWebSocketUpgrade({
          url: "/ws",
          cookies: { [sessions.cookieName]: exchanged.sessionToken },
          headers: { host: "192.168.1.50:3773", ...headers },
        } as never);

      yield* upgrade({ origin: "http://192.168.1.50:3773" });
      yield* upgrade({
        origin: "https://box.tail1234.ts.net",
        "x-forwarded-host": "box.tail1234.ts.net",
      });
      yield* upgrade({ origin: "supaterm://app" });
      yield* upgrade({ origin: "http://localhost:5733" });
      yield* upgrade({});

      const otherPort = yield* Effect.flip(upgrade({ origin: "http://192.168.1.50:8080" }));
      expect(otherPort._tag).toBe("ServerAuthInvalidCredentialError");
      const opaque = yield* Effect.flip(upgrade({ origin: "null" }));
      expect(opaque._tag).toBe("ServerAuthInvalidCredentialError");
    }).pipe(
      Effect.provide(
        layerEnvironmentAuth({
          mode: "web",
          host: "192.168.1.50",
          devUrl: new URL("http://localhost:5733"),
        }),
      ),
    ),
  );

  it.effect("accepts cookie sessions on HTTP requests only from the app's own origins", () =>
    Effect.gen(function* () {
      const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
      const sessions = yield* SessionStore.SessionStore;
      const pairing = yield* serverAuth.issuePairingCredential();
      const exchanged = yield* serverAuth.createBrowserSession(pairing.credential, requestMetadata);
      const post = (headers: Record<string, string>) =>
        serverAuth.authenticateHttpRequest({
          cookies: { [sessions.cookieName]: exchanged.sessionToken },
          headers: { host: "localhost:13773", ...headers },
        } as never);

      yield* post({ origin: "http://192.168.1.50:5733", "sec-fetch-site": "same-origin" });
      yield* post({ origin: "http://localhost:13773" });

      const otherPort = yield* Effect.flip(
        post({ origin: "http://localhost:3000", "sec-fetch-site": "same-site" }),
      );
      expect(otherPort._tag).toBe("ServerAuthInvalidCredentialError");
      const state = yield* serverAuth.getSessionState({
        cookies: { [sessions.cookieName]: exchanged.sessionToken },
        headers: { host: "localhost:13773", origin: "http://localhost:3000" },
      } as never);
      expect(state.authenticated).toBe(false);
    }).pipe(Effect.provide(layerEnvironmentAuth({ mode: "web" }))),
  );

  it.effect("keeps bearer socket upgrades independent of the page origin", () =>
    Effect.gen(function* () {
      const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
      const bearer = yield* serverAuth.issueSession();
      const verified = yield* serverAuth.authenticateWebSocketUpgrade({
        url: "/ws",
        cookies: {},
        headers: {
          host: "192.168.1.50:3773",
          origin: "http://192.168.1.50:8080",
          authorization: `Bearer ${bearer.token}`,
        },
      } as never);
      expect(verified.sessionId).toBe(bearer.sessionId);
    }).pipe(Effect.provide(layerEnvironmentAuth({ mode: "web", host: "192.168.1.50" }))),
  );
  it.effect(
    "keeps RPC and media tickets on their intended routes while accepting legacy tickets",
    () =>
      Effect.gen(function* () {
        const auth = yield* EnvironmentAuth.EnvironmentAuth;
        const sessions = yield* SessionStore.SessionStore;
        const owner = yield* auth.issueSession();
        const request = (ticket: string) =>
          ({
            url: `/ws?wsTicket=${encodeURIComponent(ticket)}`,
            cookies: {},
            headers: { host: "localhost:13773" },
          }) as never;
        for (const use of ["rpc", "media"] as const) {
          const issued = yield* auth.issueWebSocketTicket(owner, { use });
          expect(
            (yield* auth.authenticateWebSocketUpgrade(request(issued.ticket), use)).sessionId,
          ).toBe(owner.sessionId);
          expect(
            yield* Effect.flip(
              auth.authenticateWebSocketUpgrade(
                request(issued.ticket),
                use === "rpc" ? "media" : "rpc",
              ),
            ),
          ).toMatchObject({ _tag: "ServerAuthInvalidCredentialError" });
        }
        const legacy = yield* sessions.issueWebSocketToken(owner.sessionId);
        expect(
          (yield* auth.authenticateWebSocketUpgrade(request(legacy.token), "rpc")).sessionId,
        ).toBe(owner.sessionId);
        expect(
          (yield* auth.authenticateWebSocketUpgrade(request(legacy.token), "media")).sessionId,
        ).toBe(owner.sessionId);
      }).pipe(Effect.provide(layerEnvironmentAuth())),
  );

  it.effect("refuses MCP client credentials even when wrapped in a socket ticket", () =>
    Effect.gen(function* () {
      const auth = yield* EnvironmentAuth.EnvironmentAuth;
      const sessions = yield* SessionStore.SessionStore;
      const client = yield* auth.issueMcpClientSession({
        label: "External client",
        access: "full-access",
        client: { deviceType: "bot" },
      });
      const ticket = yield* sessions.issueWebSocketToken(client.sessionId, { audience: "rpc" });
      const request = {
        url: `/ws?wsTicket=${encodeURIComponent(ticket.token)}`,
        cookies: {},
        headers: { host: "localhost:13773" },
      } as never;
      expect(yield* Effect.flip(auth.authenticateWebSocketUpgrade(request))).toMatchObject({
        _tag: "ServerAuthInvalidCredentialError",
      });
    }).pipe(Effect.provide(layerEnvironmentAuth())),
  );
});
