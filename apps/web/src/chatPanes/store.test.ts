import type { EnvironmentId, ThreadId } from "@supaterm/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { DraftId } from "../draftId";
import type { ThreadRouteTarget } from "../threadRoutes";
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
  useChatPaneStore.setState({
    layout: null,
    closed: [],
    parkedSideChats: [],
    openToSide: null,
    historyMode: "replace",
  });
});

describe("reconcileRoute", () => {
  it("replaces the focused pane's thread, or focuses the pane already showing it", () => {
    store().reconcileRoute(thread("a"), roomy);
    store().split(layout().focusedPaneId, "right", thread("b"), roomy);
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
    store().split(layout().focusedPaneId, "right", thread("b"), roomy);
    expect(store().close(paneOf("b"))).toBe(true);
    expect(layout().cells).toHaveLength(1);
    expect(store().reopenClosed(roomy)).toBe(true);
    expect(orderedPanes(layout()).map((cell) => cell.target)).toEqual([thread("a"), thread("b")]);
    expect(store().historyMode).toBe("push");
  });

  it("restores the arrangement that close-others discarded", () => {
    store().reconcileRoute(thread("a"), roomy);
    store().split(layout().focusedPaneId, "right", thread("b"), roomy);
    store().split(paneOf("a"), "bottom", thread("c"), roomy);
    store().closeOthers(paneOf("a"));
    expect(layout().cells).toHaveLength(1);
    store().reopenClosed(roomy);
    expect(layout().cells).toHaveLength(3);
  });

  it("does not offer to reopen a thread that disappeared", () => {
    store().reconcileRoute(thread("a"), roomy);
    store().split(layout().focusedPaneId, "right", thread("b"), roomy);
    expect(closePaneShowingThread(thread("b").threadRef, { remember: false })).toBe(true);
    expect(store().closed).toHaveLength(0);
  });

  it("leaves the focused pane to the caller when only background panes may close", () => {
    store().reconcileRoute(thread("a"), roomy);
    store().split(layout().focusedPaneId, "right", thread("b"), roomy);
    const focused = thread("b").threadRef;
    expect(closePaneShowingThread(focused, { remember: true, onlyInBackground: true })).toBe(false);
    expect(
      closePaneShowingThread(thread("a").threadRef, { remember: true, onlyInBackground: true }),
    ).toBe(true);
  });
});

describe("side chats", () => {
  const targets = () => orderedPanes(layout()).map((cell) => cell.target);
  const openSideChat = (parent: string, sideChat: ThreadRouteTarget) => {
    store().split(paneOf(parent), "right", sideChat, roomy);
    store().linkSideChat({ parent: thread(parent), sideChat });
  };

  it("leave with their parent from either pane, and come back beside it", () => {
    store().reconcileRoute(thread("a"), roomy);
    openSideChat("a", thread("s"));
    store().reconcileRoute(thread("x"), roomy);
    expect(targets()).toEqual([thread("x")]);
    store().reconcileRoute(thread("a"), roomy);
    expect(targets()).toEqual([thread("a"), thread("s")]);
    expect(layout().focusedPaneId).toBe(paneOf("a"));
    store().focus(paneOf("a"));
    store().reconcileRoute(thread("y"), roomy);
    expect(targets()).toEqual([thread("y")]);
    store().reconcileRoute(thread("a"), roomy);
    expect(targets()).toEqual([thread("a"), thread("s")]);
  });

  it("bring their parent back when the route returns to them", () => {
    store().reconcileRoute(thread("a"), roomy);
    openSideChat("a", thread("s"));
    store().reconcileRoute(thread("x"), roomy);
    store().reconcileRoute(thread("s"), roomy);
    expect(targets()).toEqual([thread("a"), thread("s")]);
    expect(layout().focusedPaneId).toBe(paneOf("s"));
    store().reconcileRoute(thread("x"), roomy);
    store().reconcileRoute(thread("s"), { width: 600, height: 900 });
    expect(targets()).toEqual([thread("s")]);
  });

  it("come back when their parent opens beside another thread", () => {
    store().reconcileRoute(thread("a"), roomy);
    openSideChat("a", thread("s"));
    store().reconcileRoute(thread("x"), roomy);
    store().split(paneOf("x"), "right", thread("a"), roomy);
    expect(targets()).toEqual([thread("x"), thread("a"), thread("s")]);
    store().close(paneOf("a"));
    store().requestOpenToSide("right");
    store().reconcileRoute(thread("a"), roomy);
    expect(targets()).toEqual([thread("x"), thread("a"), thread("s")]);
  });

  it("take the place of their parent's last side chat when there is no room", () => {
    const snug = { width: 1200, height: 900 };
    store().reconcileRoute(thread("a"), snug);
    openSideChat("a", thread("s"));
    openSideChat("a", thread("t"));
    expect(store().swapInSideChat({ parent: thread("a"), sideChat: thread("u") })).toBe(true);
    expect(targets()).toEqual([thread("a"), thread("t"), thread("u")]);
    store().reconcileRoute(thread("x"), snug);
    store().reconcileRoute(thread("a"), snug);
    expect(targets()).toEqual([thread("a"), thread("t"), thread("u")]);
  });

  it("come back beside their parent when the route names one put away while it is on screen", () => {
    const snug = { width: 1200, height: 900 };
    store().reconcileRoute(thread("a"), snug);
    openSideChat("a", thread("s"));
    openSideChat("a", thread("t"));
    store().swapInSideChat({ parent: thread("a"), sideChat: thread("u") });
    store().reconcileRoute(thread("s"), snug);
    expect(targets()).toEqual([thread("a"), thread("t"), thread("s")]);
    expect(layout().focusedPaneId).toBe(paneOf("s"));
    store().reconcileRoute(thread("u"), roomy);
    expect(targets()).toEqual([thread("a"), thread("t"), thread("s"), thread("u")]);
    store().focus(paneOf("a"));
    store().reconcileRoute(thread("x"), roomy);
    expect(targets()).toEqual([thread("x")]);
  });

  it("tie back to their parent when they are already on screen as it returns", () => {
    store().reconcileRoute(thread("a"), roomy);
    openSideChat("a", thread("s"));
    store().reconcileRoute(thread("x"), roomy);
    store().reconcileRoute(thread("s"), { width: 600, height: 900 });
    store().split(paneOf("s"), "right", thread("y"), roomy);
    store().reconcileRoute(thread("a"), roomy);
    store().reconcileRoute(thread("z"), roomy);
    expect(targets()).toEqual([thread("z")]);
  });

  it("keep their tie when their draft becomes a thread, on screen or parked", () => {
    const draft = { kind: "draft" as const, draftId: DraftId.make("draft-s") };
    const draftThread = (draftId: DraftId) =>
      draftId === draft.draftId ? thread("s").threadRef : null;
    store().reconcileRoute(thread("a"), roomy);
    openSideChat("a", draft);
    store().reconcileRoute(thread("s"), roomy, draftThread);
    expect(targets()).toEqual([thread("a"), thread("s")]);
    store().reconcileRoute(thread("x"), roomy);
    store().reconcileRoute(thread("a"), roomy);
    expect(targets()).toEqual([thread("a"), thread("s")]);

    store().reconcileRoute(thread("b"), roomy);
    openSideChat("b", draft);
    store().reconcileRoute(thread("x"), roomy);
    store().promoteParkedDraft(draft.draftId, thread("t").threadRef);
    store().reconcileRoute(thread("b"), roomy);
    expect(targets()).toEqual([thread("b"), thread("t")]);

    const sent = { kind: "draft" as const, draftId: DraftId.make("draft-u") };
    store().reconcileRoute(thread("c"), roomy);
    openSideChat("c", sent);
    store().reconcileRoute(thread("x"), roomy, (draftId) =>
      draftId === sent.draftId ? thread("u").threadRef : null,
    );
    store().reconcileRoute(thread("c"), roomy);
    expect(targets()).toEqual([thread("c"), thread("u")]);
  });

  it("close with their parent and reopen with it, unless nothing else would be left", () => {
    store().reconcileRoute(thread("b"), roomy);
    store().split(paneOf("b"), "right", thread("a"), roomy);
    openSideChat("a", thread("s"));
    store().close(paneOf("a"));
    expect(targets()).toEqual([thread("b")]);
    store().reopenClosed(roomy);
    expect(targets()).toEqual([thread("b"), thread("a"), thread("s")]);
    store().close(paneOf("b"));
    store().close(paneOf("a"));
    expect(targets()).toEqual([thread("s")]);
  });

  it("stay on screen when their parent's pane closes because the thread is gone", () => {
    store().reconcileRoute(thread("b"), roomy);
    store().split(paneOf("b"), "right", thread("a"), roomy);
    openSideChat("a", thread("s"));
    store().close(paneOf("a"), { remember: false });
    expect(targets()).toEqual([thread("b"), thread("s")]);
    expect(store().parkedSideChats).toEqual([]);
  });

  it("let go of a pane that shows another thread or became a full thread", () => {
    store().reconcileRoute(thread("a"), roomy);
    openSideChat("a", thread("s"));
    openSideChat("a", thread("t"));
    store().replace(paneOf("s"), thread("x"), roomy);
    store().unlinkSideChat(thread("t"));
    store().reconcileRoute(thread("a"), roomy);
    store().reconcileRoute(thread("y"), roomy);
    expect(targets()).toEqual([thread("y"), thread("t"), thread("x")]);
  });

  it("stay away once promoted, wherever they were", () => {
    store().reconcileRoute(thread("a"), roomy);
    openSideChat("a", thread("s"));
    openSideChat("a", thread("t"));
    store().close(paneOf("t"));
    store().reconcileRoute(thread("x"), roomy);
    store().unlinkSideChat(thread("s"));
    store().unlinkSideChat(thread("t"));
    store().reconcileRoute(thread("a"), roomy);
    expect(targets()).toEqual([thread("a")]);
    store().reopenClosed(roomy);
    store().focus(paneOf("a"));
    store().reconcileRoute(thread("y"), roomy);
    expect(targets()).toEqual([thread("y"), thread("t")]);
  });
});

describe("isPaneInputOwner", () => {
  it("gives window input to every pane outside a split and only the focused pane inside one", () => {
    store().reconcileRoute(thread("a"), roomy);
    const first = layout().focusedPaneId;
    expect(isPaneInputOwner(first)).toBe(true);
    store().split(first, "right", thread("b"), roomy);
    expect(isPaneInputOwner(first)).toBe(false);
    expect(isPaneInputOwner(paneOf("b"))).toBe(true);
    expect(isPaneInputOwner(null)).toBe(true);
  });
});
