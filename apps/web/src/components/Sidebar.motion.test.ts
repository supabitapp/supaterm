import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createSidebarListMotion } from "./Sidebar.motion";

class TestAnimation {
  progress: number | null = 0;
  playState: AnimationPlayState = "running";
  effect = { getComputedTiming: () => ({ progress: this.progress }) };
  cancel = vi.fn(() => {
    this.playState = "idle";
  });
  private onFinish: (() => void) | undefined;
  addEventListener(_type: string, listener: () => void) {
    this.onFinish = listener;
  }
  finish() {
    this.playState = "finished";
    this.onFinish?.();
  }
}

class TestRow {
  offsetTop = 0;
  offsetLeft = 4;
  offsetWidth = 260;
  namespaceURI = "http://www.w3.org/1999/xhtml";
  dragTranslate = 0;
  style: Record<string, string> = {};
  inert = false;
  attributes: { name: string; value: string }[] = [];
  children: TestRow[] = [];
  clones: TestRow[] = [];
  remove = vi.fn();
  animations: TestAnimation[] = [];
  constructor(
    readonly name: string,
    public offsetHeight = 82,
  ) {}
  getBoundingClientRect() {
    return { top: this.offsetTop + this.dragTranslate, height: this.offsetHeight };
  }
  setAttribute(name: string, value: string) {
    this.removeAttribute(name);
    this.attributes.push({ name, value });
  }
  removeAttribute(name: string) {
    this.attributes = this.attributes.filter((attribute) => attribute.name !== name);
  }
  querySelectorAll(_selector: string): TestRow[] {
    return this.children.flatMap((child) => [child, ...child.querySelectorAll("*")]);
  }
  cloneNode(_deep: boolean): TestRow {
    const clone = new TestRow(`${this.name} clone`, this.offsetHeight);
    clone.namespaceURI = this.namespaceURI;
    clone.style = { ...this.style };
    clone.attributes = this.attributes.map((attribute) => ({ ...attribute }));
    clone.children = this.children.map((child) => child.cloneNode(true));
    this.clones.push(clone);
    return clone;
  }
  animate = vi.fn((_frames: Keyframe[], _options: KeyframeAnimationOptions) => {
    const animation = new TestAnimation();
    this.animations.push(animation);
    return animation;
  });
}

function fixture(rows: TestRow[], viewportHeight?: number) {
  const media = { matches: false };
  const events = new EventTarget();
  const parent = {
    children: rows,
    top: 0,
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
    closest: () =>
      viewportHeight === undefined
        ? null
        : { getBoundingClientRect: () => ({ top: 0, bottom: viewportHeight }) },
    ownerDocument: { defaultView: { matchMedia: () => media } },
    getBoundingClientRect: () => ({ top: parent.top }),
    append(node: TestRow) {
      parent.children.push(node);
      node.remove.mockImplementation(() => {
        parent.children = parent.children.filter((child) => child !== node);
      });
    },
  };
  function layout(next: TestRow[]) {
    let top = 8;
    for (const row of next) {
      row.offsetTop = top;
      top += row.offsetHeight + 1;
    }
    parent.children = [
      ...next,
      ...parent.children.filter((row) => row.style.position === "absolute"),
    ];
  }
  layout(rows);
  const motion = createSidebarListMotion(parent as unknown as HTMLUListElement);
  return { motion, layout, media, parent };
}

function expectMove(row: TestRow, offset: number) {
  expect(row.animate).toHaveBeenLastCalledWith(
    [{ transform: `translateY(${offset}px)` }, { transform: "translateY(0px)" }],
    { duration: 180, easing: "cubic-bezier(0.645, 0.045, 0.355, 1)" },
  );
}

beforeEach(() => vi.stubGlobal("HTMLElement", TestRow));
afterEach(() => vi.unstubAllGlobals());

describe("sidebar list motion", () => {
  it("does not reuse unrelated clicks for synchronized shelf changes after scrolling", () => {
    const header = new TestRow("Done", 32);
    const rows = Array.from({ length: 100 }, (_, index) => new TestRow(`done-${index}`, 36));
    const { motion, layout, parent } = fixture([header], 240);
    motion.update(false);
    parent.dispatchEvent(new Event("click"));
    parent.top = -1000;
    layout([header, ...rows]);
    motion.update(true, true);
    expect([header, ...rows].every((row) => row.animations.length === 0)).toBe(true);
  });

  it("keeps departing rows in their visual boxes when collapse clamps a scrolled list", () => {
    const active = new TestRow("Active", 200);
    const header = new TestRow("Done", 32);
    const rows = Array.from({ length: 100 }, (_, index) => new TestRow(`done-${index}`, 36));
    const { motion, layout, parent } = fixture([active, header, ...rows], 240);
    motion.update(false);

    parent.top = -200;
    motion.prepare();
    layout([active, header]);
    parent.top = 0;
    motion.update(true, true);

    expect(rows.slice(0, 6).every((row) => row.clones.length === 1)).toBe(true);
    expect(rows.slice(6).every((row) => row.clones.length === 0)).toBe(true);
    expect(rows[0]!.clones[0]!.style.top).toBe("42px");
    expect(rows[5]!.clones[0]!.style.top).toBe("227px");
    expectMove(header, -200);
  });

  it("animates large shelf toggles without fading offscreen history", () => {
    const header = new TestRow("Done", 32);
    const rows = Array.from({ length: 100 }, (_, index) => new TestRow(`done-${index}`, 36));
    const { motion, layout } = fixture([header], 240);
    motion.update(false);

    motion.prepare();
    layout([header, ...rows]);
    motion.update(true, true);
    expect(rows.slice(0, 6).every((row) => row.animations.length === 1)).toBe(true);
    expect(rows.slice(6).every((row) => row.animations.length === 0)).toBe(true);

    motion.prepare();
    layout([header]);
    motion.update(true, true);
    expect(rows.slice(0, 6).every((row) => row.clones.length === 1)).toBe(true);
    expect(rows.slice(6).every((row) => row.clones.length === 0)).toBe(true);
  });

  it("keeps keyboard shelf toggles immediate", () => {
    const header = new TestRow("Done", 32);
    const row = new TestRow("done", 36);
    const { motion, layout, parent } = fixture([header], 240);
    motion.update(false);
    motion.prepare();
    parent.dispatchEvent(new Event("keydown"));
    layout([header, row]);
    motion.update(true, true);
    expect(row.animate).not.toHaveBeenCalled();
    motion.dispose();
  });

  it.each(["metaKey", "ctrlKey"])(
    "animates list changes from %s shortcuts pressed inside the list",
    (modifier) => {
      const header = new TestRow("Working", 32);
      const row = new TestRow("working", 48);
      const done = new TestRow("Done", 32);
      const { motion, layout, parent } = fixture([header, row, done]);
      motion.update(true);
      parent.dispatchEvent(Object.assign(new Event("keydown"), { [modifier]: true }));
      layout([header, done]);
      motion.update(true);
      expect(row.clones).toHaveLength(1);
      expectMove(done, 49);
      motion.dispose();
    },
  );

  it("does not glide on release when motion is reduced", () => {
    const [a, b] = [new TestRow("a"), new TestRow("b")];
    const { motion, layout, media } = fixture([a, b], 240);
    motion.update(true);
    media.matches = true;
    motion.prepare();
    a.dragTranslate = 100;
    motion.release();
    layout([b, a]);
    a.dragTranslate = 0;
    motion.update(true);
    expect(a.animations).toHaveLength(0);
    expect(b.animations).toHaveLength(0);
  });

  it("fades a collapsed-shelf exit at its current visual box and a new wake in", () => {
    const a = new TestRow("a");
    const b = new TestRow("b");
    const fresh = new TestRow("new");
    a.setAttribute("data-thread-item", "a");
    a.children = [new TestRow("button")];
    a.children[0]!.setAttribute("id", "thread-control");
    a.children[0]!.setAttribute("data-testid", "thread-control");
    a.children[0]!.setAttribute("data-state", "open");
    const icon = new TestRow("provider icon");
    icon.namespaceURI = "http://www.w3.org/2000/svg";
    icon.setAttribute("id", "provider-mask");
    icon.setAttribute("mask", "url(#provider-mask)");
    a.children.push(icon);
    const { motion, layout, parent } = fixture([a, b]);
    motion.update(true);
    layout([b, a]);
    motion.update(true);
    a.animations[0]!.progress = 0.5;
    layout([b, fresh]);
    motion.update(true);
    expect(a.animations[0]!.cancel).toHaveBeenCalledOnce();
    expect(fresh.animate).toHaveBeenLastCalledWith(
      [
        { opacity: 0, transform: "translateY(83px)" },
        { opacity: 1, transform: "translateY(0px)" },
      ],
      {
        duration: 180,
        easing: "cubic-bezier(0.645, 0.045, 0.355, 1)",
      },
    );
    const clone = a.clones[0]!;
    expect(clone.style).toMatchObject({
      position: "absolute",
      top: "49.5px",
      left: "4px",
      width: "260px",
      height: "82px",
      transform: "none",
      pointerEvents: "none",
    });
    expect(clone.inert).toBe(true);
    expect(clone.attributes).toEqual([{ name: "aria-hidden", value: "true" }]);
    expect(clone.children[0]!.attributes).toEqual([{ name: "data-state", value: "open" }]);
    expect(clone.children[1]!.attributes).toEqual(icon.attributes);
    expect(clone.animate).toHaveBeenCalledWith(
      [
        { opacity: 1, transform: "translateY(0px)" },
        { opacity: 0, transform: "translateY(-83px)" },
      ],
      {
        duration: 140,
        easing: "cubic-bezier(0.32, 0.72, 0, 1)",
      },
    );
    expect(parent.children.includes(clone)).toBe(true);
    motion.update(true);
    expect(clone.animations).toHaveLength(1);
    expect(clone.clones).toHaveLength(0);
    clone.animations[0]!.finish();
    expect(parent.children.includes(clone)).toBe(false);
  });

  it("rides entering rows on the shelf displacement so an opened shelf moves as one block", () => {
    const a = new TestRow("a", 40);
    const header = new TestRow("header", 32);
    const x = new TestRow("x", 36);
    const y = new TestRow("y", 36);
    const z = new TestRow("z", 36);
    const { motion, layout } = fixture([a, header, x]);
    motion.update(true);
    layout([a, header, x, y, z]);
    for (const row of [header, x, y, z]) row.offsetTop -= 72;
    motion.update(true);
    expectMove(header, 72);
    expectMove(x, 72);
    expect(y.animate.mock.calls[0]![1]).toEqual(header.animate.mock.calls[0]![1]);
    expect(z.animate.mock.calls[0]![1]).toEqual(header.animate.mock.calls[0]![1]);
    expect(a.animate).not.toHaveBeenCalled();
    expect(y.animate).toHaveBeenLastCalledWith(
      [
        { opacity: 0, transform: "translateY(72px)" },
        { opacity: 1, transform: "translateY(0px)" },
      ],
      { duration: 180, easing: "cubic-bezier(0.645, 0.045, 0.355, 1)" },
    );
    expect(z.animate).toHaveBeenLastCalledWith(
      [
        { opacity: 0, transform: "translateY(72px)" },
        { opacity: 1, transform: "translateY(0px)" },
      ],
      { duration: 180, easing: "cubic-bezier(0.645, 0.045, 0.355, 1)" },
    );
  });

  it("rides new rows on a retained header's unfinished travel", () => {
    const header = new TestRow("header", 32);
    const above = new TestRow("above", 39);
    const incoming = new TestRow("incoming", 36);
    const { motion, layout } = fixture([header]);
    motion.update(true);
    layout([above, header]);
    motion.update(true);
    header.animations[0]!.progress = 0.25;
    layout([above, header, incoming]);
    motion.update(true);
    expect(incoming.animate).toHaveBeenLastCalledWith(
      [
        { opacity: 0, transform: "translateY(-30px)" },
        { opacity: 1, transform: "translateY(0px)" },
      ],
      { duration: 180, easing: "cubic-bezier(0.645, 0.045, 0.355, 1)" },
    );
  });

  it("keeps in-flight shelf entry travel when the shelf closes mid-animation", () => {
    const a = new TestRow("a", 40);
    const header = new TestRow("header", 32);
    const x = new TestRow("x", 36);
    const y = new TestRow("y", 36);
    const { motion, layout } = fixture([a, header, x]);
    motion.update(true);
    layout([a, header, x, y]);
    for (const row of [header, x, y]) row.offsetTop -= 36;
    motion.update(true);
    const entry = y.animations[0]!;
    header.animations[0]!.progress = 0.25;
    x.animations[0]!.progress = 0.25;
    entry.progress = 0.25;
    layout([a, header, x]);
    motion.update(true);
    expect(entry.cancel).toHaveBeenCalledOnce();
    const clone = y.clones[0]!;
    expect(clone.style.top).toBe("110px");
    expect(clone.animate).toHaveBeenCalledWith(
      [
        { opacity: 0.25, transform: "translateY(0px)" },
        { opacity: 0, transform: "translateY(9px)" },
      ],
      { duration: 140, easing: "cubic-bezier(0.32, 0.72, 0, 1)" },
    );
    expectMove(header, -9);
    expectMove(x, -9);
  });

  it("clears exit clones on pickup and does not fade the release commit", () => {
    const [a, b, c] = [new TestRow("a"), new TestRow("b"), new TestRow("c")];
    const { motion, layout, parent } = fixture([a, b]);
    motion.update(false);
    layout([b]);
    motion.update(true);
    const clone = a.clones[0]!;
    motion.suspend();
    expect(clone.animations[0]!.cancel).toHaveBeenCalledOnce();
    expect(parent.children.includes(clone)).toBe(false);
    motion.update(false);
    motion.suspend();
    layout([c]);
    motion.update(true);
    expect(b.clones).toHaveLength(0);
    expect(c.animations).toHaveLength(0);
    layout([c, a]);
    motion.update(true);
    expect(a.animate).toHaveBeenCalledWith(
      [
        { opacity: 0, transform: "translateY(0px)" },
        { opacity: 1, transform: "translateY(0px)" },
      ],
      {
        duration: 180,
        easing: "cubic-bezier(0.645, 0.045, 0.355, 1)",
      },
    );
    motion.dispose();
    expect(a.animations.at(-1)!.cancel).toHaveBeenCalledOnce();
  });

  it("carries entry opacity into a quick exit and removes artifacts on a silent update", () => {
    const a = new TestRow("a");
    const marker = new TestRow("boundary", 0);
    const { motion, layout, parent } = fixture([marker]);
    motion.update(false);
    layout([marker, a]);
    motion.update(true);
    a.animations[0]!.progress = 0.4;
    layout([]);
    motion.update(true);
    expect(marker.clones).toHaveLength(0);
    const clone = a.clones[0]!;
    expect(clone.animate).toHaveBeenCalledWith(
      [
        { opacity: 0.4, transform: "translateY(0px)" },
        { opacity: 0, transform: "translateY(40px)" },
      ],
      {
        duration: 140,
        easing: "cubic-bezier(0.32, 0.72, 0, 1)",
      },
    );
    motion.update(false);
    expect(parent.children).toEqual([]);
    expect(clone.animations[0]!.cancel).toHaveBeenCalledOnce();
  });

  it("respects reduced motion while keeping the next baseline fresh", () => {
    const a = new TestRow("a");
    const b = new TestRow("b");
    const { motion, layout, media } = fixture([a, b], 240);
    motion.update(true);
    media.matches = true;
    motion.prepare();
    layout([b, a]);
    motion.update(true, true);
    expect(a.animate).not.toHaveBeenCalled();
    media.matches = false;
    layout([a, b]);
    motion.update(true);
    expectMove(a, 83);
    expectMove(b, -83);
  });
});
