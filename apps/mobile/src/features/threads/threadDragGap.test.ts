import { describe, expect, it } from "vite-plus/test";
import { canMoveThreadToActive, threadDragAction, threadOrderAfterMove } from "./threadOrder";

describe("moving into the time-ordered inbox", () => {
  it("accepts threads from other sections without a slot", () => {
    expect(canMoveThreadToActive("pinned", true)).toBe(true);
    expect(canMoveThreadToActive("done", true)).toBe(true);
    expect(canMoveThreadToActive("snoozed", true)).toBe(true);
    expect(canMoveThreadToActive("active", true)).toBe(false);
  });
});

describe("drag action labels", () => {
  it("does not offer a parked-section reorder or snooze without a wake time", () => {
    expect(threadDragAction("done", "done")).toBeNull();
    expect(threadDragAction("active", "snoozed")).toBeNull();
    expect(
      threadOrderAfterMove(["a", "b"], "a", {
        section: "done",
        targetId: null,
        placement: "before",
      }),
    ).toBeNull();
  });
});
