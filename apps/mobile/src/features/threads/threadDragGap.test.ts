import { describe, expect, it } from "vite-plus/test";
import { canMoveThreadToActive } from "./threadOrder";

describe("moving into the time-ordered inbox", () => {
  it("accepts threads from other sections without a slot", () => {
    expect(canMoveThreadToActive("pinned", true)).toBe(true);
    expect(canMoveThreadToActive("done", true)).toBe(true);
    expect(canMoveThreadToActive("snoozed", true)).toBe(true);
    expect(canMoveThreadToActive("active", true)).toBe(false);
  });
});
