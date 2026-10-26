import { describe, expect, it, vi } from "vite-plus/test";

import { buildThreadPaletteItems } from "./CommandPaletteThreadActions";
import { buildThreadActionMenuItems, type ThreadActionMenuState } from "./threadActionMenu.logic";

const baseState: ThreadActionMenuState = {
  canOperate: true,
  branch: "feature/palette",
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

function paletteItems(state: Partial<ThreadActionMenuState> = {}) {
  const run = vi.fn(async () => {});
  const items = buildThreadPaletteItems(
    buildThreadActionMenuItems({ ...baseState, ...state }),
    run,
  );
  return { items, run };
}

describe("buildThreadPaletteItems", () => {
  it("offers every thread action the palette lacks as a standalone command", () => {
    const { items } = paletteItems();

    expect(items.map((item) => item.title)).toEqual([
      "New thread on feature/palette",
      "Pin thread",
      "Mark thread as Done",
      "Snooze thread",
      "Rename thread",
      "Regenerate title",
      "Mark thread unread",
      "Turn off automatic completion",
      "Copy workspace path",
      "Copy branch name",
      "Copy thread ID",
      "Archive thread",
      "Delete thread",
    ]);
  });

  it("offers the way back for each toggled state", () => {
    const { items } = paletteItems({ isPinned: true, isDone: true, isSnoozed: true });
    const autoMarkDone = paletteItems({ autoMarkDoneEnabled: false }).items.filter((item) =>
      item.value.startsWith("action:thread:auto-mark-done"),
    );

    expect(items.slice(1, 4).map((item) => item.title)).toEqual([
      "Unpin thread",
      "Reopen thread",
      "Wake thread",
    ]);
    expect(autoMarkDone.map((item) => item.title)).toEqual(["Turn on automatic completion"]);
  });

  it("runs the chosen snooze preset from the snooze submenu", async () => {
    const { items, run } = paletteItems();
    const snooze = items.find((item) => item.value === "action:thread:snooze");
    if (snooze?.kind !== "submenu") throw new Error("Snooze should open a submenu");
    const presets = snooze.groups.flatMap((group) => group.items);

    expect(presets.map((preset) => preset.title)).toEqual(["In 1 hour (3:00 PM)", "Custom…"]);
    const hour = presets[0];
    if (hour?.kind !== "action") throw new Error("A preset should be an action");
    await hour.run();
    expect(run).toHaveBeenCalledWith("snooze:hour");
  });

  it("keeps read-only connections to commands that do not change the thread", () => {
    const { items } = paletteItems({ canOperate: false });
    const enabled = items.filter((item) => !item.disabled).map((item) => item.title);

    expect(enabled).toEqual([
      "New thread on feature/palette",
      "Mark thread unread",
      "Copy workspace path",
      "Copy branch name",
      "Copy thread ID",
    ]);
  });
});
