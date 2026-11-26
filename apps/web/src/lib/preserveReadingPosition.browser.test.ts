import { expect, it, vi } from "vite-plus/test";

import { preserveReadingPosition } from "./preserveReadingPosition";

it("hit-tests a scroll only as it starts and settles, then keeps the line read across a resize", async () => {
  const scroller = document.body.appendChild(document.createElement("div"));
  scroller.style.cssText =
    "width: 600px; height: 300px; overflow-y: auto; overflow-anchor: none; font: 16px/24px sans-serif";
  scroller.textContent =
    "A side panel should not move the sentence being read out of view. ".repeat(300);
  using _scroller = { [Symbol.dispose]: () => scroller.remove() };
  using _preserving = { [Symbol.dispose]: preserveReadingPosition(scroller) };
  using hitTests = vi.spyOn(document, "caretPositionFromPoint");

  const scrollTo = (top: number) => {
    scroller.scrollTop = top;
    scroller.dispatchEvent(new Event("scroll"));
  };
  scrollTo(430);
  const startHitTests = hitTests.mock.calls.length;
  expect(startHitTests).toBeGreaterThan(0);
  for (let step = 2; step <= 20; step += 1) scrollTo(400 + step * 30);
  expect(hitTests).toHaveBeenCalledTimes(startHitTests);
  await vi.waitFor(() => expect(hitTests.mock.calls.length).toBeGreaterThan(startHitTests));

  const box = scroller.getBoundingClientRect();
  const read = document.caretPositionFromPoint(box.left + box.width / 2, box.top + 24)!;
  const line = document.createRange();
  line.setStart(read.offsetNode, read.offset);
  const lineTop = () => line.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  const before = lineTop();
  scroller.style.width = "400px";
  await vi.waitFor(() => expect(Math.abs(lineTop() - before)).toBeLessThan(24));
});
