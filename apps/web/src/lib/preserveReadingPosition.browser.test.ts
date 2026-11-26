import { expect, it, vi } from "vite-plus/test";

import { preserveReadingPosition } from "./preserveReadingPosition";

function mountScroller() {
  const scroller = document.body.appendChild(document.createElement("div"));
  scroller.style.cssText =
    "width: 600px; height: 300px; overflow-y: auto; overflow-anchor: none; font: 16px/24px sans-serif";
  scroller.textContent =
    "A side panel should not move the sentence being read out of view. ".repeat(300);
  const stop = preserveReadingPosition(scroller);
  const scrollTo = (top: number) => {
    scroller.scrollTop = top;
    scroller.dispatchEvent(new Event("scroll"));
  };
  const readLine = () => {
    const box = scroller.getBoundingClientRect();
    const read = document.caretPositionFromPoint(box.left + box.width / 2, box.top + 24)!;
    const line = document.createRange();
    line.setStart(read.offsetNode, read.offset);
    return () => line.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  };
  return {
    scroller,
    scrollTo,
    readLine,
    [Symbol.dispose]: () => {
      stop();
      scroller.remove();
    },
  };
}

it("hit-tests a wheel scroll only as it starts and settles, then keeps the line read across a resize", async () => {
  using mounted = mountScroller();
  const { scroller, scrollTo } = mounted;
  using hitTests = vi.spyOn(document, "caretPositionFromPoint");

  const wheel = (top: number) => {
    scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: 30 }));
    scrollTo(top);
  };
  scrollTo(400);
  wheel(430);
  const startHitTests = hitTests.mock.calls.length;
  expect(startHitTests).toBeGreaterThan(0);
  for (let step = 2; step <= 20; step += 1) wheel(400 + step * 30);
  expect(hitTests).toHaveBeenCalledTimes(startHitTests);
  await vi.waitFor(() => expect(hitTests.mock.calls.length).toBeGreaterThan(startHitTests));

  const lineTop = mounted.readLine();
  const before = lineTop();
  scroller.style.width = "400px";
  await vi.waitFor(() => expect(Math.abs(lineTop() - before)).toBeLessThan(24));
});

it.each([
  { anchor: "lost", from: 4000, to: 600 },
  { anchor: "stale", from: 600, to: 510 },
])(
  "keeps the line a jump lands on when a resize follows before the previous scroll settles ($anchor)",
  async ({ from, to }) => {
    using mounted = mountScroller();
    const { scroller, scrollTo } = mounted;
    scrollTo(from);
    scrollTo(to);
    const lineTop = mounted.readLine();
    const before = lineTop();
    scroller.style.width = "400px";
    await vi.waitFor(() => expect(Math.abs(lineTop() - before)).toBeLessThan(24));
  },
);
