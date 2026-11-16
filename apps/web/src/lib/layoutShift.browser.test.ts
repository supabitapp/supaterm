import { expect, it } from "vite-plus/test";

import { LAYOUT_SHIFT_EVENT, type LayoutShift, revealHeightChange } from "./layoutShift";

function stage({ hold = false } = {}) {
  const host = document.createElement("div");
  host.style.position = "absolute";
  host.innerHTML = '<div data-target><div style="height: 200px"></div></div><p>below</p>';
  document.body.append(host);
  const shifts: LayoutShift[] = [];
  const releases: Array<() => void> = [];
  host.addEventListener(LAYOUT_SHIFT_EVENT, (event) => {
    if (!(event instanceof CustomEvent)) return;
    const shift: LayoutShift = event.detail;
    shifts.push(shift);
    if (hold) releases.push(shift.hold());
  });
  return {
    target: host.querySelector<HTMLElement>("[data-target]")!,
    below: host.querySelector("p")!,
    shifts,
    releases,
    [Symbol.dispose]: () => host.remove(),
  };
}

it("holds the taller layout while a shrink plays and lets go when it ends", async () => {
  using dom = stage();

  const reveal = revealHeightChange(dom.target, 200, 80, 200);
  const shift = dom.shifts[0]!;

  expect(dom.target.style.height).toBe("200px");
  expect(shift.offsets[1]).toBe(-120);
  const playing = [...dom.target.getAnimations(), ...dom.below.getAnimations()];
  expect(playing.map((animation) => animation.playState)).toEqual(["running", "running"]);

  for (const animation of playing) animation.finish();
  await shift.settled;

  expect(reveal.stop()).toBeNull();
  expect(dom.target.style.height).toBe("");
  expect(dom.below.getAnimations()).toEqual([]);
});

it("waits for every hold, then plays what joined and cancels what joins too late", () => {
  using dom = stage({ hold: true });

  const reveal = revealHeightChange(dom.target, 80, 200, 80);
  const shift = dom.shifts[0]!;
  const own = dom.target.getAnimations()[0]!;
  expect(dom.target.style.height).toBe("");
  expect(own.playState).toBe("paused");

  const joined = dom.below.animate({ opacity: [0, 1] }, shift.timing);
  shift.add(joined);
  dom.releases[0]!();
  expect([own.playState, joined.playState]).toEqual(["running", "running"]);

  own.currentTime = 100;
  const stopped = reveal.stop();
  expect(stopped?.layout).toBe(200);
  expect(stopped?.visible).toBeGreaterThan(80);
  expect(stopped?.visible).toBeLessThan(200);

  const late = dom.below.animate({ opacity: [0, 1] }, shift.timing);
  shift.add(late);
  expect([own.playState, joined.playState, late.playState]).toEqual(["idle", "idle", "idle"]);
});
