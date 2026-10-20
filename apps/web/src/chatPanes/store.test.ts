import type { EnvironmentId, ThreadId } from "@supaterm/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { findPaneByTarget, orderedPanes } from "./layout";
import { isPaneInputOwner } from "./paneScope";
import { closePaneShowingThread, useChatPaneStore } from "./store";

const thread = (id: string) => ({
  kind: "server" as const,
  threadRef: { environmentId: "env" as EnvironmentId, threadId: id as ThreadId },
});
const roomy = { width: 1600, height: 900 };
const store = () => useChatPaneStore.getState();
const layout = () => store().layout!;
const paneOf = (id: string) => findPaneByTarget(layout(), thread(id))!.id;

beforeEach(() => {
  useChatPaneStore.setState({ layout: null, closed: [], openToSide: null, historyMode: "replace" });
});

describe("reconcileRoute", () => {
  it("replaces the focused pane's thread, or focuses the pane already showing it", () => {
    store().reconcileRoute(thread("a"), roomy);
    store().split(layout().focusedPaneId, "right", thread("b"));
    store().reconcileRoute(thread("a"), roomy);
    expect(layout().focusedPaneId).toBe(paneOf("a"));
    store().reconcileRoute(thread("c"), roomy);
    expect(layout().cells.map((cell) => cell.target)).toEqual([thread("c"), thread("b")]);
  });

  it("opens the next thread beside the focused pane when asked", () => {
    store().reconcileRoute(thread("a"), roomy);
    store().requestOpenToSide("right");
    store().reconcileRoute(thread("b"), roomy);
    expect(orderedPanes(layout()).map((cell) => cell.target)).toEqual([thread("a"), thread("b")]);
    expect(store().openToSide).toBeNull();
    // The request was used up: the next route replaces the focused pane again.
    store().reconcileRoute(thread("c"), roomy);
    expect(layout().cells).toHaveLength(2);
  });

  it("falls back to replacing when there is no room beside the focused pane", () => {
    store().reconcileRoute(thread("a"), roomy);
    store().requestOpenToSide("right");
    store().reconcileRoute(thread("b"), { width: 600, height: 900 });
    expect(layout().cells.map((cell) => cell.target)).toEqual([thread("b")]);
  });
});

describe("closing and reopening", () => {
  it("reopens a closed pane on the edge it sat on", () => {
    store().reconcileRoute(thread("a"), roomy);
    store().split(layout().focusedPaneId, "right", thread("b"));
    expect(store().close(paneOf("b"))).toBe(true);
    expect(layout().cells).toHaveLength(1);
    expect(store().reopenClosed()).toBe(true);
    expect(orderedPanes(layout()).map((cell) => cell.target)).toEqual([thread("a"), thread("b")]);
    expect(store().historyMode).toBe("push");
  });

  it("restores the arrangement that close-others discarded", () => {
    store().reconcileRoute(thread("a"), roomy);
    store().split(layout().focusedPaneId, "right", thread("b"));
    store().split(paneOf("a"), "bottom", thread("c"));
    store().closeOthers(paneOf("a"));
    expect(layout().cells).toHaveLength(1);
    store().reopenClosed();
    expect(layout().cells).toHaveLength(3);
  });

  it("does not offer to reopen a thread that disappeared", () => {
    store().reconcileRoute(thread("a"), roomy);
    store().split(layout().focusedPaneId, "right", thread("b"));
    expect(closePaneShowingThread(thread("b").threadRef, { remember: false })).toBe(true);
    expect(store().closed).toHaveLength(0);
  });

  it("leaves the focused pane to the caller when only background panes may close", () => {
    store().reconcileRoute(thread("a"), roomy);
    store().split(layout().focusedPaneId, "right", thread("b"));
    const focused = thread("b").threadRef;
    expect(closePaneShowingThread(focused, { remember: true, onlyInBackground: true })).toBe(false);
    expect(
      closePaneShowingThread(thread("a").threadRef, { remember: true, onlyInBackground: true }),
    ).toBe(true);
  });
});

describe("isPaneInputOwner", () => {
  it("gives window input to every pane outside a split and only the focused pane inside one", () => {
    store().reconcileRoute(thread("a"), roomy);
    const first = layout().focusedPaneId;
    expect(isPaneInputOwner(first)).toBe(true);
    store().split(first, "right", thread("b"));
    expect(isPaneInputOwner(first)).toBe(false);
    expect(isPaneInputOwner(paneOf("b"))).toBe(true);
    expect(isPaneInputOwner(null)).toBe(true);
  });
});
