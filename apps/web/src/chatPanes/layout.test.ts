import type { EnvironmentId, ThreadId } from "@supaterm/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { ThreadRouteTarget } from "../threadRoutes";
import {
  canSplitPane,
  closeOtherPanes,
  closePane,
  createPaneLayout,
  focusAdjacentPane,
  isValidPaneLayout,
  movePane,
  orderedPanes,
  paneGridlines,
  type PaneEdge,
  type PaneLayout,
  reconcileLayoutWithRoute,
  setTrackSizes,
  splitPane,
  swapPanes,
} from "./layout";

const thread = (id: string): ThreadRouteTarget => ({
  kind: "server",
  threadRef: { environmentId: "env" as EnvironmentId, threadId: id as ThreadId },
});

function ids(prefix = "id") {
  let next = 0;
  return () => `${prefix}-${(next += 1)}`;
}

const EDGES: ReadonlyArray<PaneEdge> = ["left", "right", "top", "bottom"];

function place(layout: PaneLayout, paneId: string) {
  const offsets = (sizes: ReadonlyArray<{ size: number }>) =>
    sizes.map((_track, index) => sizes.slice(0, index).reduce((sum, track) => sum + track.size, 0));
  const columnOffsets = offsets(layout.columns);
  const rowOffsets = offsets(layout.rows);
  const cell = layout.cells.find((candidate) => candidate.id === paneId)!;
  const width = layout.columns
    .slice(cell.column, cell.column + cell.columnSpan)
    .reduce((sum, track) => sum + track.size, 0);
  const height = layout.rows
    .slice(cell.row, cell.row + cell.rowSpan)
    .reduce((sum, track) => sum + track.size, 0);
  return { x: columnOffsets[cell.column], y: rowOffsets[cell.row], width, height };
}

function reachableLayouts(): PaneLayout[] {
  const createId = ids();
  const start = createPaneLayout(thread("t0"), createId);
  const layouts: PaneLayout[] = [start];
  let frontier = [start];
  for (let count = 1; count < 4; count += 1) {
    const next: PaneLayout[] = [];
    for (const layout of frontier) {
      for (const cell of layout.cells) {
        for (const edge of EDGES) {
          const split = splitPane(layout, cell.id, edge, thread(`t${count}`), createId(), createId);
          if (split) next.push(split);
        }
      }
    }
    layouts.push(...next);
    frontier = next;
  }
  return layouts;
}

describe("splitPane", () => {
  it("opens the new pane on the requested edge and keeps the split pane's id", () => {
    const createId = ids();
    const layout = createPaneLayout(thread("a"), createId);
    const original = layout.cells[0]!.id;
    const right = splitPane(layout, original, "right", thread("b"), "pane-b", createId)!;
    expect(place(right, original)).toEqual({ x: 0, y: 0, width: 50, height: 100 });
    expect(place(right, "pane-b")).toEqual({ x: 50, y: 0, width: 50, height: 100 });
    expect(right.focusedPaneId).toBe("pane-b");

    const top = splitPane(layout, original, "top", thread("b"), "pane-b", createId)!;
    expect(place(top, "pane-b")).toEqual({ x: 0, y: 0, width: 100, height: 50 });
    expect(place(top, original)).toEqual({ x: 0, y: 50, width: 100, height: 50 });
  });

  it("splits at the pane's own middle, independent of its neighbour's boundary", () => {
    const createId = ids();
    let layout = createPaneLayout(thread("a"), createId);
    const a = layout.cells[0]!.id;
    layout = splitPane(layout, a, "right", thread("b"), "b", createId)!;
    layout = splitPane(layout, a, "bottom", thread("c"), "c", createId)!;
    const [firstRow] = layout.rows;
    layout = setTrackSizes(layout, { rows: { [firstRow!.id]: 30, [layout.rows[1]!.id]: 70 } });
    layout = splitPane(layout, "b", "bottom", thread("d"), "d", createId)!;

    expect(place(layout, a)).toEqual({ x: 0, y: 0, width: 50, height: 30 });
    expect(place(layout, "c")).toEqual({ x: 0, y: 30, width: 50, height: 70 });
    expect(place(layout, "b")).toEqual({ x: 50, y: 0, width: 50, height: 50 });
    expect(place(layout, "d")).toEqual({ x: 50, y: 50, width: 50, height: 50 });
    const rowLines = paneGridlines(layout).filter((line) => line.type === "row");
    expect(rowLines).toEqual([
      { type: "row", index: 1, from: 0, span: 1 },
      { type: "row", index: 2, from: 1, span: 1 },
    ]);
  });

  it("gives a boundary that lines up with a neighbour's its own gridline", () => {
    const createId = ids();
    let layout = createPaneLayout(thread("a"), createId);
    const a = layout.cells[0]!.id;
    layout = splitPane(layout, a, "right", thread("b"), "b", createId)!;
    layout = splitPane(layout, a, "bottom", thread("c"), "c", createId)!;
    layout = splitPane(layout, "b", "bottom", thread("d"), "d", createId)!;
    const rowLines = paneGridlines(layout).filter((line) => line.type === "row");
    expect(rowLines).toHaveLength(2);
    expect(new Set(rowLines.map((line) => line.index)).size).toBe(2);
  });

  it("refuses a fifth pane and a thread that is already open", () => {
    const createId = ids();
    let layout = createPaneLayout(thread("a"), createId);
    expect(splitPane(layout, layout.cells[0]!.id, "right", thread("a"), "x", createId)).toBeNull();
    for (const name of ["b", "c", "d"]) {
      layout = splitPane(layout, layout.focusedPaneId, "right", thread(name), name, createId)!;
    }
    expect(layout.cells).toHaveLength(4);
    expect(splitPane(layout, "d", "right", thread("e"), "e", createId)).toBeNull();
  });
});

describe("reachable layouts", () => {
  const layouts = reachableLayouts();

  it("are all valid tilings", () => {
    expect(layouts.length).toBeGreaterThan(100);
    for (const layout of layouts) expect(isValidPaneLayout(layout)).toBe(true);
  });

  it("can close any pane, and the survivors still tile the grid", () => {
    for (const layout of layouts) {
      if (layout.cells.length < 2) continue;
      for (const cell of layout.cells) {
        const result = closePane(layout, cell.id);
        expect(result).not.toBeNull();
        expect(isValidPaneLayout(result!.layout)).toBe(true);
        expect(result!.layout.cells.map((candidate) => candidate.id)).not.toContain(cell.id);
        const total = (tracks: ReadonlyArray<{ size: number }>) =>
          tracks.reduce((sum, track) => sum + track.size, 0);
        expect(total(result!.layout.columns)).toBeCloseTo(100);
        expect(total(result!.layout.rows)).toBeCloseTo(100);
      }
    }
  });

  it("reopens a closed pane over the area it left", () => {
    const createId = ids("reopen");
    const overlaps = (a: ReturnType<typeof place>, b: ReturnType<typeof place>) =>
      a.x! < b.x! + b.width &&
      b.x! < a.x! + a.width &&
      a.y! < b.y! + b.height &&
      b.y! < a.y! + a.height;
    for (const layout of layouts) {
      if (layout.cells.length < 2) continue;
      for (const cell of layout.cells) {
        const before = place(layout, cell.id);
        const closed = closePane(layout, cell.id)!;
        const { paneId, edge } = closed.reopenBeside;
        const reopened = splitPane(closed.layout, paneId, edge, cell.target, "again", createId)!;
        expect(overlaps(place(reopened, "again"), before)).toBe(true);
      }
    }
  });

  it("can move any pane onto any edge of another pane", () => {
    const createId = ids("move");
    for (const layout of layouts.filter((candidate) => candidate.cells.length === 3)) {
      for (const moving of layout.cells) {
        for (const target of layout.cells) {
          if (moving.id === target.id) continue;
          for (const edge of EDGES) {
            const moved = movePane(layout, moving.id, target.id, edge, createId)!;
            expect(moved).not.toBeNull();
            expect(isValidPaneLayout(moved)).toBe(true);
            expect(moved.cells.find((cell) => cell.id === moving.id)?.target).toEqual(
              moving.target,
            );
          }
        }
      }
    }
  });

  it("never draws a gridline across a pane", () => {
    for (const layout of layouts) {
      for (const line of paneGridlines(layout)) {
        for (const cell of layout.cells) {
          const [start, span, from, length] =
            line.type === "column"
              ? [cell.column, cell.columnSpan, cell.row, cell.rowSpan]
              : [cell.row, cell.rowSpan, cell.column, cell.columnSpan];
          const crosses = start < line.index && start + span > line.index;
          const overlaps = from < line.from + line.span && from + length > line.from;
          expect(crosses && overlaps).toBe(false);
        }
      }
    }
  });
});

describe("closePane", () => {
  it("gives the closed pane's space to its neighbour and returns focus there", () => {
    const createId = ids();
    let layout = createPaneLayout(thread("a"), createId);
    const a = layout.cells[0]!.id;
    layout = splitPane(layout, a, "right", thread("b"), "b", createId)!;
    const result = closePane(layout, "b")!;
    expect(result.survivorId).toBe(a);
    expect(result.layout.cells).toHaveLength(1);
    expect(place(result.layout, a)).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    expect(result.layout.columns).toHaveLength(1);
  });

  it("returns null for the last pane", () => {
    const layout = createPaneLayout(thread("a"), ids());
    expect(closePane(layout, layout.cells[0]!.id)).toBeNull();
  });
});

describe("swapPanes", () => {
  it("exchanges places and keeps both ids", () => {
    const createId = ids();
    let layout = createPaneLayout(thread("a"), createId);
    const a = layout.cells[0]!.id;
    layout = splitPane(layout, a, "right", thread("b"), "b", createId)!;
    const swapped = swapPanes(layout, a, "b");
    expect(place(swapped, a).x).toBe(50);
    expect(place(swapped, "b").x).toBe(0);
  });
});

describe("reconcileLayoutWithRoute", () => {
  it("focuses the pane already showing the route thread", () => {
    const createId = ids();
    let layout = createPaneLayout(thread("a"), createId);
    const a = layout.cells[0]!.id;
    layout = splitPane(layout, a, "right", thread("b"), "b", createId)!;
    expect(reconcileLayoutWithRoute(layout, thread("a"), createId).focusedPaneId).toBe(a);
  });

  it("replaces the focused pane's thread with a thread that is not on screen", () => {
    const createId = ids();
    let layout = createPaneLayout(thread("a"), createId);
    const a = layout.cells[0]!.id;
    layout = splitPane(layout, a, "right", thread("b"), "b", createId)!;
    const next = reconcileLayoutWithRoute(layout, thread("c"), createId);
    expect(next.cells.find((cell) => cell.id === "b")?.target).toEqual(thread("c"));
    expect(next.cells.find((cell) => cell.id === a)?.target).toEqual(thread("a"));
  });

  it("starts a single-pane layout", () => {
    const layout = reconcileLayoutWithRoute(null, thread("a"), ids());
    expect(layout.cells).toHaveLength(1);
    expect(isValidPaneLayout(layout)).toBe(true);
  });
});

describe("focus order", () => {
  it("cycles panes in reading order", () => {
    const createId = ids();
    let layout = createPaneLayout(thread("a"), createId);
    const a = layout.cells[0]!.id;
    layout = splitPane(layout, a, "right", thread("b"), "b", createId)!;
    layout = splitPane(layout, a, "bottom", thread("c"), "c", createId)!;
    expect(orderedPanes(layout).map((cell) => cell.id)).toEqual([a, "b", "c"]);
    expect(focusAdjacentPane({ ...layout, focusedPaneId: "c" }, 1).focusedPaneId).toBe(a);
  });
});

describe("size limits", () => {
  it("refuses a split that leaves a pane below its minimum", () => {
    const createId = ids();
    const layout = createPaneLayout(thread("a"), createId);
    const a = layout.cells[0]!.id;
    expect(canSplitPane(layout, a, "right", { width: 1000, height: 800 })).toBe(true);
    expect(canSplitPane(layout, a, "right", { width: 600, height: 800 })).toBe(false);
    expect(canSplitPane(layout, a, "bottom", { width: 1000, height: 500 })).toBe(false);
  });

  it("collapses to one pane", () => {
    const createId = ids();
    let layout = createPaneLayout(thread("a"), createId);
    layout = splitPane(layout, layout.cells[0]!.id, "right", thread("b"), "b", createId)!;
    const single = closeOtherPanes(layout, "b");
    expect(single.cells).toHaveLength(1);
    expect(isValidPaneLayout(single)).toBe(true);
  });
});
