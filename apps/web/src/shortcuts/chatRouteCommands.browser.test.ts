import type { AnyRouter } from "@tanstack/react-router";
import { describe, expect, it, vi } from "vite-plus/test";

import { useThreadSelectionStore } from "../threadSelectionStore";
import { installChatRouteCommands } from "./chatRouteCommands";

type Match = { readonly routeId: string; readonly pathname: string };

function routerAt(matches: Match[], historyIndex = 0) {
  const locationOf = (next: Match[]) => ({
    pathname: next.at(-1)?.pathname ?? "/",
    state: { __TSR_index: historyIndex },
  });
  const state = {
    matches: matches.map((match) => ({ ...match, params: {} })),
    location: locationOf(matches),
  };
  const routerNavigate = vi.fn(async () => {});
  return {
    router: { state, navigate: routerNavigate } as unknown as AnyRouter,
    routerNavigate,
    navigate: (next: Match[]) => {
      state.matches = next.map((match) => ({ ...match, params: {} }));
      state.location = locationOf(next);
    },
  };
}

const CHAT: Match[] = [
  { routeId: "__root__", pathname: "/" },
  { routeId: "/_chat", pathname: "/" },
];

function pressEscape(): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key: "Escape", cancelable: true, bubbles: true });
  window.dispatchEvent(event);
  return event;
}

function addPane(name: string, clicked: string[]): HTMLElement {
  const pane = document.createElement("div");
  pane.dataset.chatPane = "";
  const trigger = document.createElement("button");
  trigger.dataset.draftProjectTrigger = "";
  trigger.addEventListener("click", () => clicked.push(name));
  pane.append(trigger);
  document.body.append(pane);
  return pane;
}

function selectThread(threadKey: string) {
  useThreadSelectionStore.getState().clearSelection();
  useThreadSelectionStore.getState().toggleThread(threadKey);
}

describe("chat route commands", () => {
  it("clears a selection made after install, reading the store at keypress time", () => {
    const { router } = routerAt(CHAT);
    using stack = new DisposableStack();
    stack.defer(installChatRouteCommands(router));
    stack.defer(() => useThreadSelectionStore.getState().clearSelection());

    selectThread("env:thread-1");
    const event = pressEscape();

    expect(event.defaultPrevented).toBe(true);
    expect(useThreadSelectionStore.getState().selectedThreadKeys.size).toBe(0);
    // With nothing selected, Escape is left for other handlers.
    expect(pressEscape().defaultPrevented).toBe(false);
  });

  it("leaves the pull requests page on an Escape nothing else took, a selection first", () => {
    const { router, routerNavigate } = routerAt([
      ...CHAT,
      { routeId: "/_chat/pull-requests", pathname: "/pull-requests" },
    ]);
    using stack = new DisposableStack();
    stack.defer(installChatRouteCommands(router));
    stack.defer(() => useThreadSelectionStore.getState().clearSelection());
    const dialog = document.createElement("div");
    dialog.addEventListener("keydown", (event) => event.preventDefault());
    document.body.append(dialog);
    stack.defer(() => dialog.remove());

    dialog.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", cancelable: true, bubbles: true }),
    );
    selectThread("env:thread-1");
    pressEscape();
    expect(useThreadSelectionStore.getState().selectedThreadKeys.size).toBe(0);
    expect(routerNavigate).not.toHaveBeenCalled();

    expect(pressEscape().defaultPrevented).toBe(true);
    expect(routerNavigate).toHaveBeenCalledWith({ to: "/" });
  });

  it("stays out of the way off the chat route and under modal pages", () => {
    const { router, navigate } = routerAt([{ routeId: "__root__", pathname: "/pair" }]);
    using stack = new DisposableStack();
    stack.defer(installChatRouteCommands(router));
    stack.defer(() => useThreadSelectionStore.getState().clearSelection());
    selectThread("env:thread-1");

    expect(pressEscape().defaultPrevented).toBe(false);

    navigate([...CHAT, { routeId: "/_chat/settings", pathname: "/settings" }]);
    expect(pressEscape().defaultPrevented).toBe(false);
    expect(useThreadSelectionStore.getState().selectedThreadKeys.size).toBe(1);

    navigate(CHAT);
    expect(pressEscape().defaultPrevented).toBe(true);
  });

  it("opens the project picker of the split pane focused when the key is pressed", () => {
    using _platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("Linux x86_64");
    const { router } = routerAt(CHAT);
    const clicked: string[] = [];
    const left = addPane("left", clicked);
    const right = addPane("right", clicked);
    using stack = new DisposableStack();
    stack.defer(installChatRouteCommands(router));
    stack.defer(() => {
      left.remove();
      right.remove();
    });
    const pressProjectPicker = () =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: ".", ctrlKey: true, cancelable: true, bubbles: true }),
      );

    right.dataset.focused = "true";
    pressProjectPicker();
    delete right.dataset.focused;
    left.dataset.focused = "true";
    pressProjectPicker();

    expect(clicked).toEqual(["right", "left"]);
  });
});
