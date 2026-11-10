import { expect, it } from "vite-plus/test";
import { AuthMcpClientAccess } from "@supaterm/contracts";

import { resolveApprovalDecision } from "./ConnectAgentSurface.logic";

it("checks a typed code even in a signed-in browser, and a level-bound code sends its level", () => {
  const signedOut = {
    clientName: "Example app",
    redirectHost: "app.example.com",
    environmentHost: "environment.example.com",
  };
  const details = { ...signedOut, csrfToken: "csrf", oneClickAccess: AuthMcpClientAccess.literals };

  // An expired code must fail rather than fall back to this browser's session.
  expect(resolveApprovalDecision({ code: " 7K2P9QXR4MZT ", access: "read-only", details })).toEqual(
    { _tag: "pairing-code", access: "read-only", code: "7K2P9QXR4MZT" },
  );
  expect(
    resolveApprovalDecision({ code: "auto-q8rz3nwd5ktc", access: "read-only", details }),
  ).toEqual({ _tag: "pairing-code", access: "auto", code: "auto-q8rz3nwd5ktc" });
  expect(resolveApprovalDecision({ code: "", access: "read-only", details })).toEqual({
    _tag: "browser-session",
    access: "read-only",
    csrfToken: "csrf",
  });
  expect(resolveApprovalDecision({ code: "", access: "read-only", details: signedOut })).toBeNull();
});
