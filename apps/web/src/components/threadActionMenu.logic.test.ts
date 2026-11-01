import { describe, expect, it } from "vite-plus/test";

import { buildThreadActionMenuItems, type ThreadActionMenuState } from "./threadActionMenu.logic";

const baseState: ThreadActionMenuState = {
  canOperate: true,
  branch: null,
  projectFilter: null,
  isPinned: false,
  isDone: false,
  autoMarkDoneEnabled: true,
  isSnoozed: false,
  canSnoozeNow: true,
  isRegeneratingTitle: false,
  isRunning: false,
  snoozePresets: [
    { id: "hour", label: "In 1 hour", whenLabel: "3:00 PM", snoozedUntil: "2026-08-07T15:00:00Z" },
  ],
};

describe("buildThreadActionMenuItems", () => {
  it.each([false, true])(
    "disables both lifecycle directions without permission (reversed: %s)",
    (reversed) => {
      const items = buildThreadActionMenuItems({
        ...baseState,
        canOperate: false,
        isPinned: reversed,
        isDone: reversed,
        isSnoozed: reversed,
      });
      const expected = reversed
        ? [
            "unpin",
            "reopen",
            "unsnooze",
            "rename",
            "regenerate-title",
            "auto-mark-done",
            "archive",
            "delete",
          ]
        : [
            "pin",
            "mark-done",
            "snooze",
            "rename",
            "regenerate-title",
            "auto-mark-done",
            "archive",
            "delete",
          ];
      expect(items.filter((item) => item.disabled).map((item) => item.id)).toEqual(expected);
      expect(
        items.find((item) => item.id === "snooze")?.children?.every((child) => child.disabled) ??
          true,
      ).toBe(true);
    },
  );

  it("offers auto-mark-done as a submenu with the current option checked", () => {
    const find = (state: ThreadActionMenuState) =>
      buildThreadActionMenuItems(state).find((item) => item.id === "auto-mark-done");
    const on = find(baseState);
    expect(on?.label).toBe("Automatic completion");
    expect(on?.children?.map((child) => [child.id, child.checked])).toEqual([
      ["auto-mark-done:enabled", true],
      ["auto-mark-done:disabled", false],
    ]);
    const off = find({ ...baseState, autoMarkDoneEnabled: false });
    expect(off?.children?.map((child) => child.checked)).toEqual([false, true]);
    const items = buildThreadActionMenuItems(baseState);
    expect(items[items.findIndex((item) => item.id === "mark-unread") + 1]?.id).toBe(
      "auto-mark-done",
    );
  });

  it("offers pinning the thread's project beside Project settings where it can", () => {
    const ids = (state: ThreadActionMenuState) =>
      buildThreadActionMenuItems(state).map((item) => item.id);
    const after = (state: ThreadActionMenuState) =>
      ids(state)[ids(state).indexOf("project-settings") + 1];
    expect(after({ ...baseState, projectPinned: false })).toBe("pin-project");
    expect(after({ ...baseState, projectPinned: true })).toBe("unpin-project");
    expect(ids({ ...baseState, projectPinned: null })).not.toContain("pin-project");
    expect(ids(baseState)).not.toContain("unpin-project");
    expect(
      buildThreadActionMenuItems({ ...baseState, canOperate: false, projectPinned: false }).find(
        (item) => item.id === "pin-project",
      )?.disabled,
    ).toBe(true);
  });

  it("disables archive and turning into a project while the thread is running", () => {
    const items = buildThreadActionMenuItems({
      ...baseState,
      isRunning: true,
      canTurnIntoProject: true,
    });
    expect(items.find((item) => item.id === "archive")?.disabled).toBe(true);
    expect(items.find((item) => item.id === "turn-into-project")?.disabled).toBe(true);
  });
});
