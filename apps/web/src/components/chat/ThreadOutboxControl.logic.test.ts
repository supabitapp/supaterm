import { describe, expect, it } from "vite-plus/test";
import { formatVoiceMessageDuration, resolveThreadOutboxStatus } from "./ThreadOutboxControl.logic";

const pending = { id: "a", status: "pending", error: null } as const;
const failed = { id: "a", status: "failed", error: "Thread is archived." } as const;
const backingOff = { id: "a", status: "pending", error: "Connection lost." } as const;
const notSending = () => false;
const notPreparing = () => false;

describe("resolveThreadOutboxStatus", () => {
  it("reports a failed message before anything else", () => {
    expect(
      resolveThreadOutboxStatus({
        head: failed,
        editingMessageId: failed.id,
        deliverable: false,
        isPreparing: () => true,
        isSending: () => true,
      }),
    ).toBe("failed");
  });

  it("reports editing over a lost connection, since the edit holds delivery", () => {
    expect(
      resolveThreadOutboxStatus({
        head: pending,
        editingMessageId: pending.id,
        deliverable: false,
        isPreparing: notPreparing,
        isSending: notSending,
      }),
    ).toBe("editing");
  });

  it("keeps reporting the first message while a later one is edited", () => {
    expect(
      resolveThreadOutboxStatus({
        head: pending,
        editingMessageId: "later",
        deliverable: true,
        isPreparing: notPreparing,
        isSending: (id) => id === pending.id,
      }),
    ).toBe("sending");
  });

  it("waits for the environment while it cannot deliver", () => {
    expect(
      resolveThreadOutboxStatus({
        head: backingOff,
        editingMessageId: null,
        deliverable: false,
        isPreparing: notPreparing,
        isSending: notSending,
      }),
    ).toBe("offline");
  });

  it("reports an attempt in flight, even when an earlier attempt failed", () => {
    expect(
      resolveThreadOutboxStatus({
        head: backingOff,
        editingMessageId: null,
        deliverable: true,
        isPreparing: notPreparing,
        isSending: (id) => id === backingOff.id,
      }),
    ).toBe("sending");
  });

  it("reports a retry backoff when the last attempt failed transiently", () => {
    expect(
      resolveThreadOutboxStatus({
        head: backingOff,
        editingMessageId: null,
        deliverable: true,
        isPreparing: notPreparing,
        isSending: notSending,
      }),
    ).toBe("retrying");
  });

  it("reports transcription while the head's voice message is prepared", () => {
    expect(
      resolveThreadOutboxStatus({
        head: backingOff,
        editingMessageId: null,
        deliverable: true,
        isPreparing: (id) => id === backingOff.id,
        isSending: notSending,
      }),
    ).toBe("transcribing");
  });

  it("reports a lost connection over an interrupted transcription", () => {
    expect(
      resolveThreadOutboxStatus({
        head: pending,
        editingMessageId: null,
        deliverable: false,
        isPreparing: (id) => id === pending.id,
        isSending: notSending,
      }),
    ).toBe("offline");
  });

  it("falls back to waiting for delivery to start", () => {
    expect(
      resolveThreadOutboxStatus({
        head: pending,
        editingMessageId: null,
        deliverable: true,
        isPreparing: notPreparing,
        isSending: notSending,
      }),
    ).toBe("waiting");
  });
});

describe("formatVoiceMessageDuration", () => {
  it.each([
    [400, "0:00"],
    [1_500, "0:02"],
    [59_400, "0:59"],
    [61_000, "1:01"],
    [300_000, "5:00"],
  ])("formats %d ms as %s", (durationMs, label) => {
    expect(formatVoiceMessageDuration(durationMs)).toBe(label);
  });
});
