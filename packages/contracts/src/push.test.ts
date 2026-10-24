import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { ClientActivityReportInput } from "./background.ts";
import { normalizePushGatewayOrigin, PushRegisterInput } from "./push.ts";
import { DEFAULT_SERVER_SETTINGS, ServerSettingsPatch } from "./settings.ts";

describe("normalizePushGatewayOrigin", () => {
  it.each([
    ["https://push.supaterm.com", "https://push.supaterm.com"],
    [" https://push.example.com/ ", "https://push.example.com"],
    ["https://push.example.com:8443", "https://push.example.com:8443"],
    ["http://localhost:8000", "http://localhost:8000"],
    ["http://127.0.0.1:8000/", "http://127.0.0.1:8000"],
  ])("accepts %s", (input, origin) => {
    expect(normalizePushGatewayOrigin(input)).toBe(origin);
  });

  it.each([
    "http://push.example.com",
    "http://192.168.1.2:8000",
    "https://push.example.com/v1",
    "https://user:pass@push.example.com",
    "https://push.example.com/?q=1",
    "wss://push.example.com",
    "push.example.com",
  ])("rejects %s", (input) => {
    expect(normalizePushGatewayOrigin(input)).toBeNull();
  });
});

describe("push settings", () => {
  it("turns push on with the official gateway by default", () => {
    expect(DEFAULT_SERVER_SETTINGS.pushNotificationsEnabled).toBe(true);
    expect(DEFAULT_SERVER_SETTINGS.pushGatewayOrigins).toEqual(["https://push.supaterm.com"]);
  });

  it("only accepts normalized origins in a settings patch", () => {
    const decode = Schema.decodeUnknownSync(ServerSettingsPatch);
    expect(decode({ pushGatewayOrigins: ["http://localhost:8000"] })).toEqual({
      pushGatewayOrigins: ["http://localhost:8000"],
    });
    expect(() => decode({ pushGatewayOrigins: ["https://push.example.com/"] })).toThrow();
  });
});

describe("push registration input", () => {
  const input = {
    registrationId: "6f1c2b9e-3a4d-4e5f-8a6b-7c8d9e0f1a2b",
    gatewayOrigin: "https://push.supaterm.com",
    handle: "AQIDBAUGBwgJCgsMDQ4PEA",
    recipientKey: {
      keyId: "0b9f8e7d-6c5b-4a39-8281-7f6e5d4c3b2a",
      publicKey: "ebVWLo_mVPlAeLES6KmLp5AfhTrmlb7X4OORC60ElmQ",
    },
    preview: "titles",
    kinds: { approval: true, input: true, completion: false, failure: true, "usage-limit": true },
  };
  const decode = Schema.decodeUnknownSync(PushRegisterInput);

  it("decodes a phone's registration", () => {
    expect(decode({ ...input, deviceName: "  Khoi's iPhone " }).deviceName).toBe("Khoi's iPhone");
  });

  it("rejects IDs the envelope cannot bind exactly", () => {
    expect(() =>
      decode({ ...input, registrationId: input.registrationId.toUpperCase() }),
    ).toThrow();
    expect(() => decode({ ...input, handle: `${input.handle}A` })).toThrow();
  });
});

describe("client activity reports", () => {
  it("decodes reports with and without the latest interaction", () => {
    const decode = Schema.decodeUnknownSync(Schema.toCodecJson(ClientActivityReportInput));
    const report = {
      clientId: "client",
      clientKind: "mobile",
      visible: true,
      focused: true,
      recentlyInteracted: true,
      scopes: [{ type: "thread", threadId: "thread-1" }],
      observedAt: "2026-10-21T00:00:00.000Z",
    };
    expect(decode(report)).not.toHaveProperty("lastInteractionAt");
    expect(
      decode({ ...report, lastInteractionAt: "2026-10-21T00:00:01.000Z" }).lastInteractionAt
        ?.epochMilliseconds,
    ).toBe(Date.parse("2026-10-21T00:00:01.000Z"));
  });
});
