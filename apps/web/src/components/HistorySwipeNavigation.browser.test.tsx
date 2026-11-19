import { describe, expect, it, vi } from "vite-plus/test";

import { render } from "../../test/render";
import { HistorySwipeNavigation } from "./HistorySwipeNavigation";

const { fake } = vi.hoisted(() => ({
  fake: <
    F extends (...args: never[]) => unknown = { call(...args: Array<unknown>): unknown }["call"],
  >(
    initial?: F,
  ) => {
    const script = { queue: [] as Array<F>, fallback: initial };
    const target = {
      call: (...args: Parameters<F>) =>
        (script.queue.shift() ?? script.fallback)?.(...args) as ReturnType<F>,
    };
    const spy = vi.spyOn(target, "call");
    const scripted = Object.assign(spy, {
      implement: (next: F) => {
        script.fallback = next;
        return scripted;
      },
      implementOnce: (next: F) => {
        script.queue.push(next);
        return scripted;
      },
      reset: (next?: F) => {
        script.queue = [];
        script.fallback = next ?? initial;
        spy.mockClear();
        return scripted;
      },
    });
    return scripted;
  },
}));
const navigateHistory = vi.hoisted(() => fake());
vi.mock("../navigationHistory", () => ({ canNavigateHistory: () => true, navigateHistory }));

function swipe(target: Element, deltaX: number) {
  for (const delta of [deltaX, 0]) {
    target.dispatchEvent(new WheelEvent("wheel", { deltaX: delta, bubbles: true, composed: true }));
  }
}

describe("HistorySwipeNavigation", () => {
  it.each([
    ["scrolling left inside a shadow-root scroller keeps the thread", "shadow", 100, -130, false],
    ["scrolling right inside a shadow-root scroller keeps the thread", "shadow", 100, 130, false],
    [
      "scrolling after a shadow scroller remount keeps the thread",
      "shadow-remount",
      100,
      130,
      false,
    ],
    ["scrolling left inside a scroller keeps the thread", "light", 100, -130, false],
    ["swiping back at a shadow-root scroller's left edge navigates", "shadow", 0, -130, true],
    ["swiping back over a panel without overflow navigates", "none", 0, -130, true],
    ["a swipe that started in a closed dialog keeps the thread", "closed-dialog", 0, -130, false],
    ["swiping over the terminal keeps the thread", "data-terminal-owner=drawer", 0, -130, false],
    [
      "swiping over a browser preview keeps the thread",
      "data-preview-viewport=tab",
      0,
      -130,
      false,
    ],
    [
      "swiping over a streamed browser preview keeps the thread",
      "data-server-browser-surface=tab",
      0,
      -130,
      false,
    ],
    ["swiping inside a confirmation keeps the thread", "role=alertdialog", 0, -130, false],
    ["swiping on a modal's backdrop keeps the thread", "data-slot=dialog-backdrop", 0, -130, false],
  ] as const)("%s", async (_name, scroller, scrollLeft, deltaX, navigates) => {
    navigateHistory.reset();
    await using screen = await render(<HistorySwipeNavigation platform="MacIntel" />);
    const panel = screen.container.appendChild(document.createElement("div"));
    const root = scroller.startsWith("shadow") ? panel.attachShadow({ mode: "open" }) : panel;
    const viewport = root.appendChild(document.createElement("div"));
    const surface = scroller.includes("=") ? scroller.split("=") : null;
    if (surface) panel.setAttribute(surface[0]!, surface[1]!);
    const noOverflow = scroller === "none" || scroller === "closed-dialog" || surface !== null;
    viewport.style.cssText = `width: 200px; overflow-x: ${noOverflow ? "visible" : "auto"}`;
    const content = viewport.appendChild(document.createElement("div"));
    content.style.cssText = `height: 20px; width: ${noOverflow ? 100 : 1000}px`;
    viewport.scrollLeft = scrollLeft;

    if (scroller === "closed-dialog") {
      panel.setAttribute("role", "dialog");
      content.dispatchEvent(new WheelEvent("wheel", { deltaX: -1, bubbles: true, composed: true }));
      panel.remove();
      screen.container.appendChild(viewport);
    }

    if (scroller === "shadow-remount") {
      content.dispatchEvent(new WheelEvent("wheel", { deltaX: 1, bubbles: true, composed: true }));
      const replacement = viewport.cloneNode(true) as HTMLDivElement;
      viewport.replaceWith(replacement);
      replacement.scrollLeft = scrollLeft;
      swipe(replacement, deltaX);
    } else {
      swipe(content, deltaX);
    }

    expect(navigateHistory).toHaveBeenCalledTimes(navigates ? 1 : 0);
  });

  it("a horizontal mouse wheel tick off macOS keeps the thread", async () => {
    navigateHistory.reset();
    await using screen = await render(<HistorySwipeNavigation platform="Win32" />);
    const content = screen.container.appendChild(document.createElement("div"));
    content.style.cssText = "height: 20px; width: 100px";

    swipe(content, -120);

    expect(navigateHistory).not.toHaveBeenCalled();
  });

  const drift = Array.from({ length: 30 }, () => [-4, 15] as const);
  it.each([
    [
      "a vertical scroll that starts slightly diagonally keeps the thread",
      [[-5, 3], ...drift],
      false,
    ],
    [
      "a swipe that leans diagonally for two events navigates",
      [
        [-5, 3],
        [-2, 2],
        [-150, 0],
      ],
      true,
    ],
    ["a single diagonal event past the trigger keeps the thread", [[-130, 100]], false],
  ] as const)("%s", async (_name, events, navigates) => {
    navigateHistory.reset();
    await using screen = await render(<HistorySwipeNavigation platform="MacIntel" />);
    const panel = screen.container.appendChild(document.createElement("div"));
    for (const [deltaX, deltaY] of [...events, [0, 0] as const]) {
      panel.dispatchEvent(
        new WheelEvent("wheel", { deltaX, deltaY, bubbles: true, composed: true }),
      );
    }

    expect(navigateHistory).toHaveBeenCalledTimes(navigates ? 1 : 0);
  });
});
