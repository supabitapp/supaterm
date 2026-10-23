import { describe, expect, it } from "vite-plus/test";

import { executeThreadUndo, planThreadUndo, type ThreadUndoStep } from "./threadUndo.ts";

describe("planThreadUndo", () => {
  it("reopens, re-pins at the old placement, and restores the snooze after marking Done", () => {
    expect(
      planThreadUndo("mark-done", {
        pinnedAt: "2026-09-02T00:00:00.000Z",
        pinOrderKey: "m",
        snoozedUntil: "2099-01-01T09:00:00.000Z",
      }),
    ).toEqual([
      { action: "reopen" },
      { action: "pin", orderKey: "m" },
      { action: "snooze", snoozedUntil: "2099-01-01T09:00:00.000Z" },
    ]);
    expect(planThreadUndo("mark-done", null)).toEqual([{ action: "reopen" }]);
  });

  it("only restores the snooze when the thread was already Done", () => {
    expect(
      planThreadUndo("mark-done", {
        doneOverride: "done",
        snoozedUntil: "2099-01-01T09:00:00.000Z",
      }),
    ).toEqual([{ action: "snooze", snoozedUntil: "2099-01-01T09:00:00.000Z" }]);
  });

  it("re-pins before restoring the snooze that pinning clears", () => {
    expect(
      planThreadUndo("unpin", { pinOrderKey: null, snoozedUntil: "2099-01-01T09:00:00.000Z" }),
    ).toEqual([{ action: "pin" }, { action: "snooze", snoozedUntil: "2099-01-01T09:00:00.000Z" }]);
    expect(planThreadUndo("snooze")).toEqual([{ action: "unsnooze" }]);
  });
});

describe("executeThreadUndo", () => {
  it("skips an expired snooze and stops after a failed step", async () => {
    const executed: ThreadUndoStep[] = [];
    const run = (failing: ThreadUndoStep["action"] | null) =>
      executeThreadUndo(
        [
          { action: "reopen" },
          { action: "snooze", snoozedUntil: "2000-01-01T00:00:00.000Z" },
          { action: "pin" },
        ],
        async (step) => {
          executed.push(step);
          return step.action !== failing;
        },
        (result) => result,
      );
    expect(await run(null)).toBe(true);
    expect(executed.map((step) => step.action)).toEqual(["reopen", "pin"]);
    executed.length = 0;
    expect(await run("reopen")).toBe(false);
    expect(executed.map((step) => step.action)).toEqual(["reopen"]);
  });
});
