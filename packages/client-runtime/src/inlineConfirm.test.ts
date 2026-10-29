import { describe, expect, it } from "vite-plus/test";

import {
  createInlineConfirm,
  INLINE_CONFIRM_GUARD_MS,
  INLINE_CONFIRM_TIMEOUT_MS,
} from "./inlineConfirm.ts";

function track() {
  const changes: Array<string | null> = [];
  const timers = new Set<{ readonly ms: number; readonly run: () => void }>();
  const confirm = createInlineConfirm<"remove" | "retry">(
    (armed) => changes.push(armed),
    (ms, run) => {
      const timer = { ms, run };
      timers.add(timer);
      return () => timers.delete(timer);
    },
  );
  const expire = () => {
    for (const timer of timers) {
      timers.delete(timer);
      timer.run();
    }
  };
  return { changes, confirm, timers, expire };
}

describe("createInlineConfirm", () => {
  it("confirms only a second press of the same key after the guard", () => {
    const { changes, confirm } = track();
    expect(confirm.press("remove", 1_000)).toBe(false);
    expect(confirm.press("remove", 1_000 + INLINE_CONFIRM_GUARD_MS - 1)).toBe(false);
    expect(changes).toEqual(["remove"]);
    expect(confirm.press("remove", 1_000 + INLINE_CONFIRM_GUARD_MS)).toBe(true);
    expect(changes).toEqual(["remove", null]);
    expect(confirm.press("remove", 2_000)).toBe(false);
    expect(changes.at(-1)).toBe("remove");
  });

  it("confirms a prompt deliberate press but not the second click of a double-click", () => {
    const { confirm } = track();
    confirm.press("remove", 1_000);
    expect(confirm.press("remove", 1_150)).toBe(false);
    expect(confirm.press("remove", 1_300)).toBe(true);
  });

  it("moves the arming to another key instead of confirming it", () => {
    const { changes, confirm } = track();
    confirm.press("remove", 0);
    expect(confirm.press("retry", 1_000)).toBe(false);
    expect(confirm.press("retry", 1_000 + INLINE_CONFIRM_GUARD_MS - 1)).toBe(false);
    expect(confirm.press("retry", 1_000 + INLINE_CONFIRM_GUARD_MS)).toBe(true);
    expect(changes).toEqual(["remove", "retry", null]);
  });

  it("disarms on the timeout, which each new arming replaces", () => {
    const { changes, confirm, timers, expire } = track();
    confirm.press("remove", 0);
    confirm.press("retry", 0);
    expect([...timers].map((timer) => timer.ms)).toEqual([INLINE_CONFIRM_TIMEOUT_MS]);
    expire();
    expect(changes).toEqual(["remove", "retry", null]);
    expect(timers.size).toBe(0);
    expect(confirm.press("retry", INLINE_CONFIRM_TIMEOUT_MS)).toBe(false);
  });

  it("disarms on request, or only when the given key is the armed one", () => {
    const { changes, confirm, timers } = track();
    confirm.disarm();
    confirm.press("remove", 0);
    confirm.disarm("retry");
    expect(changes).toEqual(["remove"]);
    confirm.disarm("remove");
    confirm.press("retry", 0);
    confirm.disarm();
    expect(changes).toEqual(["remove", null, "retry", null]);
    expect(timers.size).toBe(0);
  });

  it("hands out one attachment per key whose cleanup disarms only that key", () => {
    const { changes, confirm } = track();
    const detachRemove = confirm.attach("remove");
    expect(confirm.attach("remove")).toBe(detachRemove);
    confirm.press("remove", 0);
    confirm.attach("retry")()();
    expect(changes).toEqual(["remove"]);
    detachRemove()();
    expect(changes).toEqual(["remove", null]);
  });
});
