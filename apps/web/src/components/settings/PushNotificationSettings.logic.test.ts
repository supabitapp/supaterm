import {
  AuthSessionId,
  MAX_PUSH_GATEWAY_ORIGINS,
  type PushRegistrationSummary,
} from "@supaterm/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { activePushSessionIds, addPushGatewayOrigin } from "./PushNotificationSettings.logic";

describe("addPushGatewayOrigin", () => {
  it("stores the normalized origin", () => {
    expect(addPushGatewayOrigin([], "  https://Push.Example.com/ ")).toEqual({
      origins: ["https://push.example.com"],
    });
    expect(addPushGatewayOrigin([], "http://localhost:8787")).toEqual({
      origins: ["http://localhost:8787"],
    });
  });

  it.each(["push.example.com", "http://push.example.com", "https://push.example.com/v1"])(
    "rejects %s",
    (draft) => {
      expect(addPushGatewayOrigin([], draft)).toHaveProperty("error");
    },
  );

  it("rejects an origin that is already allowed once normalized", () => {
    expect(
      addPushGatewayOrigin(["https://push.supaterm.com"], "https://PUSH.supaterm.com/"),
    ).toEqual({ error: "https://push.supaterm.com is already allowed." });
  });

  it("caps the list at the host's limit", () => {
    const full = Array.from(
      { length: MAX_PUSH_GATEWAY_ORIGINS },
      (_, index) => `https://gateway-${index}.example.com`,
    );
    expect(addPushGatewayOrigin(full, "https://one-more.example.com")).toHaveProperty("error");
    expect(addPushGatewayOrigin(full.slice(1), "https://one-more.example.com")).toHaveProperty(
      "origins",
    );
  });
});

describe("activePushSessionIds", () => {
  const registration = (
    sessionId: string,
    status: PushRegistrationSummary["status"],
  ): PushRegistrationSummary => ({
    registrationId: "00000000-0000-4000-8000-000000000000",
    sessionId: AuthSessionId.make(sessionId),
    deviceName: null,
    gatewayOrigin: "https://push.supaterm.com",
    preview: "titles",
    status,
    createdAt: DateTime.makeUnsafe(0),
    isCurrentSession: false,
  });

  it("marks only sessions with an active registration", () => {
    expect(
      activePushSessionIds([registration("phone", "active"), registration("old-phone", "gone")]),
    ).toEqual(new Set(["phone"]));
    expect(activePushSessionIds(null)).toEqual(new Set());
  });
});
