import { describe, expect, it } from "vite-plus/test";

import { paneDropVerb, resolvePaneDropZone } from "./paneDrop";

const pane = { left: 100, top: 50, width: 800, height: 600 };

describe("resolvePaneDropZone", () => {
  it("reads each edge band and the middle", () => {
    expect(resolvePaneDropZone(pane, { x: 120, y: 350 })).toBe("left");
    expect(resolvePaneDropZone(pane, { x: 880, y: 350 })).toBe("right");
    expect(resolvePaneDropZone(pane, { x: 500, y: 70 })).toBe("top");
    expect(resolvePaneDropZone(pane, { x: 500, y: 630 })).toBe("bottom");
    expect(resolvePaneDropZone(pane, { x: 500, y: 350 })).toBe("center");
  });

  it("scales the bands with the pane, within fixed bounds", () => {
    // 22% of 800 is 176px, above the 160px ceiling.
    expect(resolvePaneDropZone(pane, { x: 100 + 155, y: 350 })).toBe("left");
    expect(resolvePaneDropZone(pane, { x: 100 + 165, y: 350 })).toBe("center");
    const small = { left: 0, top: 0, width: 200, height: 200 };
    // 22% of 200 is 44px, below the 56px floor.
    expect(resolvePaneDropZone(small, { x: 50, y: 100 })).toBe("left");
  });

  it("resolves a corner to the edge the pointer is relatively closest to", () => {
    expect(resolvePaneDropZone(pane, { x: 105, y: 80 })).toBe("left");
    expect(resolvePaneDropZone(pane, { x: 140, y: 52 })).toBe("top");
  });
});

describe("paneDropVerb", () => {
  it("names what the drop does", () => {
    const threads = { kind: "threads", threads: [] } as const;
    const pane = { kind: "pane", paneId: "a" } as const;
    expect(paneDropVerb("right", threads)).toBe("Split right");
    expect(paneDropVerb("center", threads)).toBe("Open here");
    expect(paneDropVerb("center", pane)).toBe("Swap panes");
  });
});
