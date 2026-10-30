import { MessageId } from "@supaterm/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { pendingThreadMessageJump, requestThreadMessageJump } from "./threadMessageJump";

describe("threadMessageJump", () => {
  it("lets a jump lapse when its thread never showed", () => {
    using now = vi.spyOn(Date, "now").mockReturnValue(0);
    requestThreadMessageJump("thread-a", MessageId.make("message-1"));
    expect(pendingThreadMessageJump("thread-a")).toMatchObject({ messageId: "message-1" });
    expect(pendingThreadMessageJump("thread-b")).toBeNull();
    now.mockReturnValue(30_000);
    expect(pendingThreadMessageJump("thread-a")).toBeNull();
  });
});
