import { MessageId } from "@supaterm/contracts";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { pendingThreadMessageJump, requestThreadMessageJump } from "./threadMessageJump";

describe("threadMessageJump", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("lets a jump lapse when its thread never showed", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(0);
    requestThreadMessageJump("thread-a", MessageId.make("message-1"));
    expect(pendingThreadMessageJump("thread-a")?.messageId).toBe("message-1");
    expect(pendingThreadMessageJump("thread-b")).toBeNull();
    vi.setSystemTime(30_000);
    expect(pendingThreadMessageJump("thread-a")).toBeNull();
  });
});
