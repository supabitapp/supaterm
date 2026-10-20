import type { EnvironmentId, ThreadId } from "@supaterm/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { findPaneByTarget, paneTargetKey } from "./layout";
import { commitPaneDrop, paneDropVerb, resolvePaneDropZone } from "./paneDrop";
import { useChatPaneStore } from "./store";

const pane = { left: 100, top: 50, width: 800, height: 600 };

describe("resolvePaneDropZone", () => {
  it("reads each edge band and the middle", () => {
    expect(resolvePaneDropZone(pane, { x: 120, y: 350 })).toBe("left");
    expect(resolvePaneDropZone(pane, { x: 880, y: 350 })).toBe("right");
    expect(resolvePaneDropZone(pane, { x: 500, y: 70 })).toBe("top");
    expect(resolvePaneDropZone(pane, { x: 500, y: 630 })).toBe("bottom");
    expect(resolvePaneDropZone(pane, { x: 500, y: 350 })).toBe("center");
  });

  it("scales the bands with the pane, within fixed bounds", () => {
    // 22% of 800 is 176px, above the 160px ceiling.
    expect(resolvePaneDropZone(pane, { x: 100 + 155, y: 350 })).toBe("left");
    expect(resolvePaneDropZone(pane, { x: 100 + 165, y: 350 })).toBe("center");
    const small = { left: 0, top: 0, width: 200, height: 200 };
    // 22% of 200 is 44px, below the 56px floor.
    expect(resolvePaneDropZone(small, { x: 50, y: 100 })).toBe("left");
  });

  it("resolves a corner to the edge the pointer is relatively closest to", () => {
    expect(resolvePaneDropZone(pane, { x: 105, y: 80 })).toBe("left");
    expect(resolvePaneDropZone(pane, { x: 140, y: 52 })).toBe("top");
  });
});

describe("paneDropVerb", () => {
  it("names what the drop does", () => {
    const threads = { kind: "threads", threads: [] } as const;
    const pane = { kind: "pane", paneId: "a" } as const;
    expect(paneDropVerb("right", threads)).toBe("Split right");
    expect(paneDropVerb("center", threads)).toBe("Open here");
    expect(paneDropVerb("center", pane)).toBe("Swap panes");
    expect(paneDropVerb("top", pane)).toBe("Move up");
  });
});

describe("commitPaneDrop", () => {
  const thread = (id: string) => ({
    kind: "server" as const,
    threadRef: { environmentId: "env" as EnvironmentId, threadId: id as ThreadId },
  });
  const store = () => useChatPaneStore.getState();
  const paneOf = (id: string) => findPaneByTarget(store().layout!, thread(id))!;

  beforeEach(() => {
    useChatPaneStore.setState({ layout: null, closed: [], openToSide: null });
    store().reconcileRoute(thread("a"), { width: 1600, height: 900 });
    store().split(store().layout!.focusedPaneId, "right", thread("b"));
  });

  it("moves a thread that is already open instead of opening it twice", () => {
    const dragged = { kind: "threads", threads: [thread("a").threadRef] } as const;
    expect(commitPaneDrop({ paneId: paneOf("b").id, zone: "bottom" }, dragged)).toBe(true);
    const targets = store().layout!.cells.map((cell) => cell.target);
    expect(targets).toHaveLength(2);
    expect(
      targets.filter((target) => paneTargetKey(target) === paneTargetKey(thread("a"))),
    ).toHaveLength(1);
    expect(paneOf("a").row).toBeGreaterThan(paneOf("b").row);
  });

  it("swaps when an open thread is dropped on another pane's middle", () => {
    const before = paneOf("a").column;
    commitPaneDrop(
      { paneId: paneOf("b").id, zone: "center" },
      { kind: "threads", threads: [thread("a").threadRef] },
    );
    expect(store().layout!.cells).toHaveLength(2);
    expect(paneOf("a").column).not.toBe(before);
  });
});
