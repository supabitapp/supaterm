import { describe, expect, it } from "vite-plus/test";

import { encodeOAuthScope, parseOAuthScope } from "./oauthScope.ts";

describe("OAuth scopes", () => {
  it("parses an RFC 6749 space-delimited scope set without duplicating permissions", () => {
    expect(parseOAuthScope("orchestration:read access:write orchestration:read")).toEqual([
      "orchestration:read",
      "access:write",
    ]);
  });

  it("rejects whitespace that is not the SP delimiter or introduces empty tokens", () => {
    expect(parseOAuthScope("orchestration:read\taccess:write")).toBeNull();
    expect(parseOAuthScope("orchestration:read  access:write")).toBeNull();
  });

  it("encodes requested scopes as a space-delimited set", () => {
    expect(encodeOAuthScope(["orchestration:read", "access:write"])).toBe(
      "orchestration:read access:write",
    );
  });
});
