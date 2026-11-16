import { expect, it } from "vite-plus/test";

import { LAYOUT_SHIFT_EVENT, type LayoutShift, revealHeightChange } from "~/lib/layoutShift";
import { followTimelineLayoutShifts } from "./timelineLayoutShift";

const ROW_CONTAINMENT = "layout style paint";

/**
 * A header, four rows and a footer, built the way the timeline's list builds them. The
 * two middle rows hold messages 100px tall.
 */
function timeline() {
  const scroll = document.createElement("div");
  scroll.style.cssText = "position: absolute; top: 0; width: 200px; height: 500px; overflow: auto";
  const row = (body: string) =>
    `<div style="contain: ${ROW_CONTAINMENT}; position: absolute; left: 0; right: 0"><div class="messages-timeline-row-frame">${body}</div></div>`;
  const message = '<div data-message><div style="height: 100px"></div></div>';
  scroll.innerHTML = `<div>
    <div style="height: 20px"></div>
    <div style="position: relative">${[
      row('<div style="height: 100px"></div>'),
      row(message),
      row(message),
      row('<div style="height: 600px"></div>'),
    ].join("")}</div>
    <div style="height: 40px"></div>
  </div>`;
  document.body.append(scroll);
  const [header, content, footer] = [...scroll.firstElementChild!.children] as HTMLElement[];
  const rows = [...content!.children] as HTMLElement[];
  const messages = [...scroll.querySelectorAll<HTMLElement>("[data-message]")];
  const shifts: LayoutShift[] = [];
  scroll.addEventListener(LAYOUT_SHIFT_EVENT, (event) => {
    if (event instanceof CustomEvent) shifts.push(event.detail);
  });
  const stopFollowing = followTimelineLayoutShifts(scroll);
  /** Positions the rows from their sizes, as the list does a frame after one resizes. */
  const relayout = () =>
    new Promise<void>((resolve) => {
      const observer = new MutationObserver(() => {
        observer.disconnect();
        resolve();
      });
      observer.observe(content!, { attributes: true });
      let top = 0;
      for (const item of rows) {
        item.style.top = `${top}px`;
        top += item.offsetHeight;
      }
      content!.style.height = `${top}px`;
    });
  const parts = [header!, ...rows, footer!];
  return {
    scroll,
    rows,
    messages,
    frame: (index: number) =>
      rows[index]!.querySelector<HTMLElement>(".messages-timeline-row-frame")!,
    resize: (target: HTMLElement, height: number) => {
      target.querySelector<HTMLElement>("div")!.style.height = `${height}px`;
    },
    shifts,
    relayout,
    stopFollowing,
    /** Where the header, each row and the footer sit on screen. */
    places: () => parts.map((part) => part.getBoundingClientRect().top),
    animations: () => [...messages, ...parts].flatMap((element) => element.getAnimations()),
    [Symbol.dispose]: () => {
      stopFollowing();
      scroll.remove();
    },
  };
}

const shifted = (places: number[], by: number[]) =>
  places.map((place, index) => place + by[index]!);

it("starts a growing row's reveal once the list has moved what sits below it", async () => {
  using list = timeline();
  await list.relayout();
  const before = list.places();

  list.resize(list.messages[0]!, 220);
  revealHeightChange(list.messages[0]!, 100, 220, 100);
  expect(list.animations().map((animation) => animation.playState)).toEqual(["paused"]);

  await list.relayout();

  expect(list.messages[0]!.getAnimations()[0]?.playState).toBe("running");
  expect(list.places()).toEqual(before);
  for (const animation of list.animations()) animation.finish();
  await list.shifts[0]!.settled;
  expect(list.places()).toEqual(shifted(before, [0, 0, 0, 120, 120, 120]));
  expect(list.animations()).toEqual([]);
});

it("gives the list a shrinking row's final height at once and follows where the list scrolls", async () => {
  using list = timeline();
  list.resize(list.messages[0]!, 220);
  await list.relayout();
  list.scroll.scrollTop = list.scroll.scrollHeight;
  const end = list.scroll.scrollTop;
  const before = list.places();

  list.resize(list.messages[0]!, 100);
  revealHeightChange(list.messages[0]!, 220, 100, 220);
  expect(list.rows[1]!.offsetHeight).toBe(100);
  expect(list.messages[0]!.offsetHeight).toBe(220);
  expect(list.rows[1]!.style.contain).toBe("layout style");

  // The shorter list ends 120px sooner, so the browser pulls everything down by that much.
  await list.relayout();

  expect(list.scroll.scrollTop).toBe(end - 120);
  expect(list.places()).toEqual(before);
  for (const animation of list.animations()) animation.finish();
  await list.shifts[0]!.settled;
  expect(list.places()).toEqual(shifted(before, [120, 120, 120, 0, 0, 0]));
  expect(list.rows[1]!.offsetHeight).toBe(100);
  expect([list.frame(1).style.marginBottom, list.rows[1]!.style.contain]).toEqual([
    "",
    ROW_CONTAINMENT,
  ]);
});

it("slides the rows in view when a row scrolled out above them shrinks", async () => {
  using list = timeline();
  list.resize(list.messages[0]!, 220);
  await list.relayout();
  list.scroll.scrollTop = 350;
  expect(list.rows[1]!.getBoundingClientRect().bottom).toBeLessThan(0);
  const before = list.places();

  list.resize(list.messages[0]!, 100);
  revealHeightChange(list.messages[0]!, 220, 100, 220);
  await list.relayout();

  expect(list.places()).toEqual(before);
  for (const animation of list.animations()) animation.finish();
  await list.shifts[0]!.settled;
  expect(list.places()).toEqual(shifted(before, [0, 0, 0, -120, -120, -120]));
});

it("takes over from an interrupted reveal where everything is", async () => {
  using list = timeline();
  await list.relayout();
  list.resize(list.messages[0]!, 220);
  const growing = revealHeightChange(list.messages[0]!, 100, 220, 100);
  await list.relayout();
  for (const animation of list.animations()) animation.currentTime = 100;
  const midway = list.places();

  const stopped = growing.stop()!;
  list.resize(list.messages[0]!, 100);
  revealHeightChange(list.messages[0]!, stopped.visible, 100, stopped.layout);
  expect(list.places()).toEqual(midway);

  await list.relayout();

  list.places().forEach((place, index) => expect(place).toBeCloseTo(midway[index]!, 1));
  expect(list.messages[0]!.getAnimations()[0]?.playState).toBe("running");
});

it("leaves one row's slide alone when another row starts to shift", async () => {
  using list = timeline();
  await list.relayout();
  list.resize(list.messages[0]!, 220);
  revealHeightChange(list.messages[0]!, 100, 220, 100);
  await list.relayout();
  for (const animation of list.animations()) {
    animation.pause();
    animation.currentTime = 100;
  }
  const midway = list.places();

  list.resize(list.messages[1]!, 220);
  revealHeightChange(list.messages[1]!, 100, 220, 100);
  await list.relayout();

  list.places().forEach((place, index) => expect(place).toBeCloseTo(midway[index]!, 1));
});

it("lets go of a waiting reveal and a held row when it stops following", async () => {
  using list = timeline();
  list.resize(list.messages[0]!, 220);
  await list.relayout();
  list.resize(list.messages[0]!, 100);
  revealHeightChange(list.messages[0]!, 220, 100, 220);

  list.stopFollowing();

  expect(list.messages[0]!.getAnimations()[0]?.playState).toBe("running");
  expect([list.frame(1).style.marginBottom, list.rows[1]!.style.contain]).toEqual([
    "",
    ROW_CONTAINMENT,
  ]);
  list.resize(list.messages[1]!, 150);
  await list.relayout();
  expect(list.rows.flatMap((item) => item.getAnimations())).toEqual([]);
});
