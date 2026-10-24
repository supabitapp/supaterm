import { describe, expect, it, vi } from "vite-plus/test";

import { fakeTimers } from "../../test/render";
import { announce, cancelAnnouncement } from "./announce";

function spokenText() {
  return Array.from(document.querySelectorAll('[aria-live="polite"]'), (region) =>
    region.textContent?.trim(),
  ).filter(Boolean);
}

describe("announce", () => {
  it("waits for focus to settle, then speaks waiting messages together", () => {
    using _timers = fakeTimers();
    const composer = document.createElement("textarea");
    document.body.append(composer);
    using _composer = { [Symbol.dispose]: () => composer.remove() };

    announce("Marked 1 thread as Done, Ctrl+Z to undo");
    announce("Model: Claude Sonnet 5.5");
    vi.advanceTimersByTime(200);
    composer.focus();
    vi.advanceTimersByTime(200);
    expect(spokenText()).toEqual([]);

    vi.advanceTimersByTime(50);
    expect(spokenText()).toEqual([
      "Marked 1 thread as Done, Ctrl+Z to undo. Model: Claude Sonnet 5.5",
    ]);
  });

  it("speaks the same message twice in a row through the other region", () => {
    using _timers = fakeTimers();
    const regionTexts = () =>
      Array.from(document.querySelectorAll('[aria-live="polite"]'), (region) => region.textContent);

    announce("Claude");
    vi.runAllTimers();
    const first = regionTexts();
    announce("Claude");
    vi.runAllTimers();

    expect(regionTexts()).toEqual(first.toReversed());
    expect(regionTexts()).toContain("Claude");
  });

  it("replaces a waiting message from the same source", () => {
    using _timers = fakeTimers();

    announce("Marked 1 thread as Done, Ctrl+Z to undo", "undo");
    announce("Opening in VS Code");
    announce("Marked 2 threads as Done, Ctrl+Z to undo", "undo");
    vi.runAllTimers();

    expect(spokenText()).toEqual(["Opening in VS Code. Marked 2 threads as Done, Ctrl+Z to undo"]);

    announce("Marked 1 thread as Done, Ctrl+Z to undo", "undo");
    announce("Opening in Zed");
    cancelAnnouncement("undo");
    vi.runAllTimers();

    expect(spokenText()).toEqual(["Opening in Zed"]);
  });
});
