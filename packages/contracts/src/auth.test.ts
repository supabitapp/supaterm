import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import {
  AuthEnvironmentScopes,
  authScopeRequiredResponse,
  AuthStandardClientScopes,
  authScopeResponse,
  AuthSessionState,
  sessionGrantsScope,
} from "./auth.ts";

describe("authorization grants", () => {
  it("reports the full grant", () => {
    expect(authScopeResponse(AuthStandardClientScopes)).toEqual({
      scopes: AuthStandardClientScopes,
    });
  });

  it("names the exact scope a denial needs", () => {
    expect(authScopeRequiredResponse("settings:write")).toEqual({
      requiredScope: "settings:write",
    });
  });

  it("does not expand broad scopes into other permissions", () => {
    const session = { authenticated: true, scopes: ["orchestration:operate"] as const };
    expect(sessionGrantsScope(session, "orchestration:operate")).toBe(true);
    expect(sessionGrantsScope(session, "settings:write")).toBe(false);
  });

  it.each([
    { session: { authenticated: true, scopes: ["settings:write"] }, expected: true },
    { session: { authenticated: false, scopes: ["settings:write"] }, expected: false },
    { session: { authenticated: true, scopes: [] }, expected: false },
    { session: { authenticated: true }, expected: false },
  ] as const)("checks an explicit grant: $expected", ({ session, expected }) => {
    expect(sessionGrantsScope(session, "settings:write")).toBe(expected);
  });
});

const decodeScopes = Schema.decodeUnknownSync(AuthEnvironmentScopes);
const decodeSessionState = Schema.decodeUnknownSync(AuthSessionState);

describe("AuthEnvironmentScopes", () => {
  it("drops scopes this build no longer knows instead of failing the decode", () => {
    expect(
      decodeScopes(["orchestration:read", "relay:read", "terminal:operate", "relay:write"]),
    ).toEqual(["orchestration:read", "terminal:operate"]);
  });

  it("keeps a stored session readable when its scopes include retired ones", () => {
    const session = decodeSessionState({
      authenticated: true,
      auth: {
        policy: "remote-reachable",
        bootstrapMethods: ["one-time-token"],
        sessionMethods: ["browser-session-cookie", "bearer-access-token"],
        sessionCookieName: "supaterm_session",
      },
      sessionMethod: "bearer-access-token",
      scopes: ["orchestration:read", "relay:read"],
    });
    expect(session.scopes).toEqual(["orchestration:read"]);
  });
});
