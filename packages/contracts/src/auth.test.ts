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
import { EnvironmentAuthInvalidError } from "./environmentHttp.ts";
import { DpopFailureReason } from "./index.ts";

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

const authFailureJson = Schema.toCodecJson(EnvironmentAuthInvalidError);
const decodeAuthFailure = Schema.decodeUnknownSync(authFailureJson);
const encodeAuthFailure = Schema.encodeSync(authFailureJson);
const decodeDpopFailureReason = Schema.decodeUnknownSync(DpopFailureReason);
const authFailure = {
  _tag: "EnvironmentAuthInvalidError",
  code: "auth_invalid",
  reason: "invalid_credential",
  traceId: "auth-trace",
};

describe("DPoP authentication failures", () => {
  it.each([
    "time_window",
    "key_mismatch",
    "request_mismatch",
    "token_mismatch",
    "invalid_proof",
    "replay",
  ])("preserves %s through the HTTP error codec", (dpopFailureReason) => {
    expect(decodeDpopFailureReason(dpopFailureReason)).toBe(dpopFailureReason);
    const input = { ...authFailure, dpopFailureReason };
    expect(encodeAuthFailure(decodeAuthFailure(input))).toEqual(input);
  });

  it("keeps older authentication failures readable without a DPoP reason", () => {
    expect(encodeAuthFailure(decodeAuthFailure(authFailure))).toEqual(authFailure);
  });

  it("rejects unknown or verifier-internal reasons at the wire boundary", () => {
    for (const dpopFailureReason of ["method_mismatch", "url_mismatch", "future_reason", null]) {
      expect(() => decodeAuthFailure({ ...authFailure, dpopFailureReason })).toThrow();
    }
  });
});
