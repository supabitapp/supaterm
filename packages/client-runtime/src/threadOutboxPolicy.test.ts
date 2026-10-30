import { describe, expect, it } from "vite-plus/test";
import { resolveThreadOutboxDeliveryAction } from "./threadOutboxPolicy.ts";

const connected = {
  threadExists: false,
  shellStatus: "live" as const,
  environmentConnected: true,
  threadBusy: false,
  awaitingCreatedThread: false,
};

describe("thread outbox with omitted shell rows", () => {
  it.each(["pending", "failed"] as const)(
    "waits for a %s family lookup before cleanup or creation",
    (threadFamilyRead) => {
      for (const isCreation of [false, true]) {
        expect(
          resolveThreadOutboxDeliveryAction({ ...connected, isCreation, threadFamilyRead }),
        ).toBe("wait");
      }
    },
  );

  it("removes a follow-up only after its missing thread is authoritative", () => {
    expect(
      resolveThreadOutboxDeliveryAction({
        ...connected,
        isCreation: false,
        threadFamilyRead: "settled",
      }),
    ).toBe("remove");
    expect(
      resolveThreadOutboxDeliveryAction({
        ...connected,
        isCreation: true,
        threadFamilyRead: "settled",
      }),
    ).toBe("send");
  });

  it("keeps the old-server path and sends a found thread while another lookup is pending", () => {
    expect(resolveThreadOutboxDeliveryAction({ ...connected, isCreation: false })).toBe("remove");
    expect(
      resolveThreadOutboxDeliveryAction({
        ...connected,
        isCreation: false,
        threadExists: true,
        threadFamilyRead: "pending",
      }),
    ).toBe("send");
  });
});
