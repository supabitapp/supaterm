import { describe, expect, it } from "vite-plus/test";

import { fitAndroidHeaderActions } from "./headerMenu.android";

const sidebarActions = ["Show pull requests", "Search threads", "Open settings"];

describe("fitAndroidHeaderActions", () => {
  it("keeps every action inline in a 280dp sidebar at the default text size", () => {
    expect(
      fitAndroidHeaderActions(sidebarActions, {
        width: 264,
        buttonSize: 48,
        gap: 4,
        reservedButtons: 1,
      }),
    ).toEqual({ visibleActions: sidebarActions, overflowActions: [] });
  });

  it("moves actions into the overflow menu when the largest text size cannot fit them", () => {
    expect(
      fitAndroidHeaderActions(sidebarActions, {
        width: 258,
        buttonSize: 66,
        gap: 5.5,
        reservedButtons: 1,
      }),
    ).toEqual({ visibleActions: [], overflowActions: sidebarActions });
  });

  it("keeps the overflow button's slot when only some actions fit", () => {
    expect(
      fitAndroidHeaderActions(sidebarActions, {
        width: 258,
        buttonSize: 66,
        gap: 5.5,
        reservedButtons: 0,
      }),
    ).toEqual({
      visibleActions: ["Show pull requests"],
      overflowActions: ["Search threads", "Open settings"],
    });
  });

  it("keeps a phone's actions inline at the largest text size", () => {
    const phoneActions = ["Search threads", "Open settings"];
    expect(
      fitAndroidHeaderActions(phoneActions, {
        width: 390,
        buttonSize: 66,
        gap: 5.5,
        reservedButtons: 1,
      }),
    ).toEqual({ visibleActions: phoneActions, overflowActions: [] });
  });

  it("keeps every action inline before the row has been measured", () => {
    expect(
      fitAndroidHeaderActions(sidebarActions, {
        width: 0,
        buttonSize: 66,
        gap: 5.5,
        reservedButtons: 1,
      }),
    ).toEqual({ visibleActions: sidebarActions, overflowActions: [] });
  });
});
