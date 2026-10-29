import { MessageId } from "@supaterm/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { createMessageJumpRunner, type MessageJumpView } from "./messageJump.ts";

const jump = { key: 1, messageId: MessageId.make("message-pinned") };
const unloaded: MessageJumpView = {
  rowIndex: -1,
  loaded: false,
  cursor: "message-10",
  history: { loading: false, hasMoreHistory: true, error: null },
};

function handlers() {
  return {
    start: vi.fn(),
    scroll: vi.fn(),
    unfold: vi.fn(),
    loadEarlier: vi.fn(),
    fail: vi.fn(),
  };
}

describe("createMessageJumpRunner", () => {
  it("scrolls once to a message that has a row", () => {
    const advance = createMessageJumpRunner();
    const on = handlers();
    advance(jump, { ...unloaded, rowIndex: 4, loaded: true }, on);
    advance(jump, { ...unloaded, rowIndex: 4, loaded: true }, on);
    expect(on.start).toHaveBeenCalledOnce();
    expect(on.scroll).toHaveBeenCalledExactlyOnceWith(4);
  });

  it("pages earlier history, unfolds the loaded message, then scrolls to it", () => {
    const advance = createMessageJumpRunner();
    const on = handlers();
    advance(jump, unloaded, on);
    advance(jump, { ...unloaded, history: { ...unloaded.history!, loading: true } }, on);
    advance(jump, { ...unloaded, cursor: "message-1", loaded: true }, on);
    advance(jump, { ...unloaded, cursor: "message-1", loaded: true, rowIndex: 2 }, on);
    expect(on.loadEarlier).toHaveBeenCalledExactlyOnceWith(jump.messageId);
    expect(on.unfold).toHaveBeenCalledExactlyOnceWith(jump.messageId);
    expect(on.scroll).toHaveBeenCalledExactlyOnceWith(2);
    expect(on.fail).not.toHaveBeenCalled();
  });

  it("waits for a requested page through rerenders that come before loading starts", () => {
    const advance = createMessageJumpRunner();
    const on = handlers();
    advance(jump, unloaded, on);
    advance(jump, unloaded, on);
    advance(jump, { ...unloaded, history: { ...unloaded.history!, loading: true } }, on);
    advance(jump, { ...unloaded, cursor: "message-1", rowIndex: 0, loaded: true }, on);
    expect(on.fail).not.toHaveBeenCalled();
    expect(on.loadEarlier).toHaveBeenCalledOnce();
    expect(on.scroll).toHaveBeenCalledExactlyOnceWith(0);
  });

  it("reports a message that stays hidden after unfolding as missing", () => {
    const advance = createMessageJumpRunner();
    const on = handlers();
    advance(jump, { ...unloaded, loaded: true }, on);
    advance(jump, { ...unloaded, loaded: true }, on);
    expect(on.fail).toHaveBeenCalledExactlyOnceWith(jump, "missing");
  });

  it("reports a message absent from all history as missing", () => {
    const advance = createMessageJumpRunner();
    const on = handlers();
    advance(jump, unloaded, on);
    advance(jump, { ...unloaded, history: { ...unloaded.history!, loading: true } }, on);
    advance(
      jump,
      {
        ...unloaded,
        cursor: "message-1",
        history: { ...unloaded.history!, hasMoreHistory: false },
      },
      on,
    );
    expect(on.loadEarlier).toHaveBeenCalledOnce();
    expect(on.fail).toHaveBeenCalledExactlyOnceWith(jump, "missing");
  });

  it("retries an earlier history failure once and reports a repeated one as a history error", () => {
    const advance = createMessageJumpRunner();
    const on = handlers();
    const failed = { ...unloaded, history: { ...unloaded.history!, error: "offline" } };
    advance(jump, failed, on);
    advance(jump, { ...unloaded, history: { ...unloaded.history!, loading: true } }, on);
    advance(jump, failed, on);
    expect(on.loadEarlier).toHaveBeenCalledOnce();
    expect(on.fail).toHaveBeenCalledExactlyOnceWith(jump, "history-error");
  });

  it("starts over for a new jump", () => {
    const advance = createMessageJumpRunner();
    const on = handlers();
    advance(jump, { ...unloaded, rowIndex: 1, loaded: true }, on);
    advance({ ...jump, key: 2 }, { ...unloaded, rowIndex: 1, loaded: true }, on);
    expect(on.start).toHaveBeenCalledTimes(2);
    expect(on.scroll).toHaveBeenCalledTimes(2);
  });
});
