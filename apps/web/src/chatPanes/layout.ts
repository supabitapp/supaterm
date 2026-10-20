import { scopedThreadKey } from "@supaterm/client-runtime/environment";

import type { ThreadRouteTarget } from "../threadRoutes";

const MAX_CHAT_PANES = 4;
const CHAT_PANE_MIN_WIDTH = 360;
const CHAT_PANE_MIN_HEIGHT = 320;

export type PaneAxis = "column" | "row";
export type PaneEdge = "left" | "right" | "top" | "bottom";

export interface PaneTrack {
  readonly id: string;
  /** Percentage of the workspace along the track's axis. */
  readonly size: number;
}

export interface PaneCell {
  readonly id: string;
  readonly target: ThreadRouteTarget;
  readonly column: number;
  readonly columnSpan: number;
  readonly row: number;
  readonly rowSpan: number;
}

/**
 * Panes tile a grid. A pane spans whole tracks, so a split inserts a track and
 * widens every pane that crossed it; the pane being split keeps its id, which
 * keeps its chat view mounted wherever the layout moves it.
 */
export interface PaneLayout {
  readonly columns: ReadonlyArray<PaneTrack>;
  readonly rows: ReadonlyArray<PaneTrack>;
  readonly cells: ReadonlyArray<PaneCell>;
  readonly focusedPaneId: string;
}

export interface PaneLayoutSize {
  readonly width: number;
  readonly height: number;
}

export function paneTargetKey(target: ThreadRouteTarget): string {
  return target.kind === "server" ? scopedThreadKey(target.threadRef) : `draft:${target.draftId}`;
}

export function createPaneLayout(target: ThreadRouteTarget, createId: () => string): PaneLayout {
  const id = createId();
  return {
    columns: [{ id: createId(), size: 100 }],
    rows: [{ id: createId(), size: 100 }],
    cells: [{ id, target, column: 0, columnSpan: 1, row: 0, rowSpan: 1 }],
    focusedPaneId: id,
  };
}

export function findPane(layout: PaneLayout, paneId: string): PaneCell | null {
  return layout.cells.find((cell) => cell.id === paneId) ?? null;
}

export function findPaneByTarget(layout: PaneLayout, target: ThreadRouteTarget): PaneCell | null {
  const key = paneTargetKey(target);
  return layout.cells.find((cell) => paneTargetKey(cell.target) === key) ?? null;
}

export function focusedPane(layout: PaneLayout): PaneCell {
  return findPane(layout, layout.focusedPaneId) ?? layout.cells[0]!;
}

/** Panes in reading order: top to bottom, then left to right. */
export function orderedPanes(layout: PaneLayout): ReadonlyArray<PaneCell> {
  return [...layout.cells].toSorted((a, b) => a.row - b.row || a.column - b.column);
}

export function isSplit(layout: PaneLayout | null): boolean {
  return layout !== null && layout.cells.length > 1;
}

export function focusPane(layout: PaneLayout, paneId: string): PaneLayout {
  if (layout.focusedPaneId === paneId || !findPane(layout, paneId)) return layout;
  return { ...layout, focusedPaneId: paneId };
}

export function focusAdjacentPane(layout: PaneLayout, offset: 1 | -1): PaneLayout {
  const panes = orderedPanes(layout);
  const index = panes.findIndex((pane) => pane.id === layout.focusedPaneId);
  const next = panes[(index + offset + panes.length) % panes.length];
  return next ? focusPane(layout, next.id) : layout;
}

/** Shows `target` in `paneId`. A target already in another pane focuses that pane instead. */
export function replacePaneTarget(
  layout: PaneLayout,
  paneId: string,
  target: ThreadRouteTarget,
): PaneLayout {
  const existing = findPaneByTarget(layout, target);
  if (existing) return focusPane(layout, existing.id);
  return {
    ...layout,
    cells: layout.cells.map((cell) => (cell.id === paneId ? { ...cell, target } : cell)),
  };
}

/**
 * The route names the focused pane's thread. A route target already on screen
 * focuses its pane; any other target replaces the focused pane's thread.
 */
export function reconcileLayoutWithRoute(
  layout: PaneLayout | null,
  target: ThreadRouteTarget,
  createId: () => string,
): PaneLayout {
  if (layout === null) return createPaneLayout(target, createId);
  const existing = findPaneByTarget(layout, target);
  if (existing) return focusPane(layout, existing.id);
  return replacePaneTarget(layout, focusedPane(layout).id, target);
}

function axisTracks(layout: PaneLayout, axis: PaneAxis) {
  return axis === "column" ? layout.columns : layout.rows;
}

function cellStart(cell: PaneCell, axis: PaneAxis) {
  return axis === "column" ? cell.column : cell.row;
}

function cellSpan(cell: PaneCell, axis: PaneAxis) {
  return axis === "column" ? cell.columnSpan : cell.rowSpan;
}

function withCellPosition(cell: PaneCell, axis: PaneAxis, start: number, span: number): PaneCell {
  return axis === "column"
    ? { ...cell, column: start, columnSpan: span }
    : { ...cell, row: start, rowSpan: span };
}

function withTracks(
  layout: PaneLayout,
  axis: PaneAxis,
  tracks: ReadonlyArray<PaneTrack>,
): PaneLayout {
  return axis === "column" ? { ...layout, columns: tracks } : { ...layout, rows: tracks };
}

const edgeAxis = (edge: PaneEdge): PaneAxis =>
  edge === "left" || edge === "right" ? "column" : "row";
const edgeLeads = (edge: PaneEdge) => edge === "left" || edge === "top";

/**
 * Cuts a track `offset` percent in, widening every pane that crossed it. An
 * offset of 0 leaves a zero-size track, so a boundary that lines up with an
 * existing one still resizes on its own.
 */
function splitTrack(
  layout: PaneLayout,
  axis: PaneAxis,
  trackIndex: number,
  offset: number,
  createId: () => string,
): PaneLayout {
  const tracks = axisTracks(layout, axis);
  const track = tracks[trackIndex]!;
  const nextTracks = [
    ...tracks.slice(0, trackIndex),
    { id: createId(), size: offset },
    { id: track.id, size: track.size - offset },
    ...tracks.slice(trackIndex + 1),
  ];
  const cells = layout.cells.map((cell) => {
    const start = cellStart(cell, axis);
    const span = cellSpan(cell, axis);
    if (start > trackIndex) return withCellPosition(cell, axis, start + 1, span);
    if (start + span - 1 >= trackIndex) return withCellPosition(cell, axis, start, span + 1);
    return cell;
  });
  return withTracks({ ...layout, cells }, axis, nextTracks);
}

/**
 * Opens `target` beside `paneId` on `edge`, as a new pane with `newPaneId`.
 * The split pane keeps its id; panes crossing the new boundary widen to keep
 * their size. Returns null when the layout is full or the target is on screen.
 */
export function splitPane(
  layout: PaneLayout,
  paneId: string,
  edge: PaneEdge,
  target: ThreadRouteTarget,
  newPaneId: string,
  createId: () => string,
): PaneLayout | null {
  if (layout.cells.length >= MAX_CHAT_PANES || findPaneByTarget(layout, target)) return null;
  return insertPane(layout, paneId, edge, target, newPaneId, createId);
}

function insertPane(
  layout: PaneLayout,
  paneId: string,
  edge: PaneEdge,
  target: ThreadRouteTarget,
  newPaneId: string,
  createId: () => string,
): PaneLayout | null {
  const pane = findPane(layout, paneId);
  if (!pane) return null;
  const axis = edgeAxis(edge);
  const tracks = axisTracks(layout, axis);
  const start = cellStart(pane, axis);
  const end = start + cellSpan(pane, axis);
  const offsets = tracks.map((_track, index) =>
    tracks.slice(0, index).reduce((sum, track) => sum + track.size, 0),
  );
  // Split at the pane's own middle, whatever boundaries its neighbours have.
  const middle = (offsets[start]! + offsets[end - 1]! + tracks[end - 1]!.size) / 2;
  let trackIndex = start;
  while (trackIndex < end - 1 && offsets[trackIndex + 1]! <= middle) trackIndex += 1;
  const next = splitTrack(layout, axis, trackIndex, middle - offsets[trackIndex]!, createId);
  // The cut sits before the track that kept the original id, at trackIndex + 1.
  const boundary = trackIndex + 1;
  const split = findPane(next, paneId)!;
  const firstSpan = boundary - start;
  const secondSpan = cellSpan(split, axis) - firstSpan;
  const leading = edgeLeads(edge);
  const newCell = withCellPosition(
    { ...split, id: newPaneId, target },
    axis,
    leading ? start : boundary,
    leading ? firstSpan : secondSpan,
  );
  const keptCell = withCellPosition(
    split,
    axis,
    leading ? boundary : start,
    leading ? secondSpan : firstSpan,
  );
  return {
    ...next,
    cells: [...next.cells.map((cell) => (cell.id === paneId ? keptCell : cell)), newCell],
    focusedPaneId: newPaneId,
  };
}

const CLOSE_FILL_ORDER: ReadonlyArray<PaneEdge> = ["left", "top", "right", "bottom"];

/** Panes on `edge` of `cell` that exactly cover that edge, so they can grow into its area. */
function edgeNeighbours(layout: PaneLayout, cell: PaneCell, edge: PaneEdge): PaneCell[] | null {
  const axis = edgeAxis(edge);
  const across: PaneAxis = axis === "column" ? "row" : "column";
  const boundary = edgeLeads(edge)
    ? cellStart(cell, axis)
    : cellStart(cell, axis) + cellSpan(cell, axis);
  const from = cellStart(cell, across);
  const to = from + cellSpan(cell, across);
  const touching = layout.cells.filter((other) => {
    if (other.id === cell.id) return false;
    const otherBoundary = edgeLeads(edge)
      ? cellStart(other, axis) + cellSpan(other, axis)
      : cellStart(other, axis);
    if (otherBoundary !== boundary) return false;
    const otherFrom = cellStart(other, across);
    return otherFrom < to && otherFrom + cellSpan(other, across) > from;
  });
  if (touching.length === 0) return null;
  const fits = touching.every(
    (other) =>
      cellStart(other, across) >= from && cellStart(other, across) + cellSpan(other, across) <= to,
  );
  const covered = touching.reduce((sum, other) => sum + cellSpan(other, across), 0);
  return fits && covered === to - from ? touching : null;
}

/** Removes track boundaries no pane starts on, merging their sizes. */
function normalizePaneLayout(layout: PaneLayout): PaneLayout {
  let next = layout;
  for (const axis of ["column", "row"] as const) {
    let tracks = axisTracks(next, axis);
    let index = 1;
    while (index < tracks.length) {
      const used = next.cells.some((cell) => cellStart(cell, axis) === index);
      if (used) {
        index += 1;
        continue;
      }
      const merged = {
        id: tracks[index - 1]!.id,
        size: tracks[index - 1]!.size + tracks[index]!.size,
      };
      tracks = [...tracks.slice(0, index - 1), merged, ...tracks.slice(index + 1)];
      const cells = next.cells.map((cell) => {
        const start = cellStart(cell, axis);
        const span = cellSpan(cell, axis);
        if (start >= index) return withCellPosition(cell, axis, start - 1, span);
        if (start + span > index) return withCellPosition(cell, axis, start, span - 1);
        return cell;
      });
      next = withTracks({ ...next, cells }, axis, tracks);
    }
  }
  return next;
}

export interface ClosePaneResult {
  readonly layout: PaneLayout;
  /** The pane that took the closed pane's place, or that keeps focus. */
  readonly survivorId: string;
  /** Where the closed pane sat relative to a pane that grew into its space, to reopen it there. */
  readonly reopenBeside: { readonly paneId: string; readonly edge: PaneEdge };
}

const OPPOSITE_EDGE: Record<PaneEdge, PaneEdge> = {
  left: "right",
  right: "left",
  top: "bottom",
  bottom: "top",
};

/** Closes `paneId`; neighbours that share its whole edge grow into its area. Null for the last pane. */
export function closePane(layout: PaneLayout, paneId: string): ClosePaneResult | null {
  const cell = findPane(layout, paneId);
  if (!cell || layout.cells.length < 2) return null;
  for (const edge of CLOSE_FILL_ORDER) {
    const neighbours = edgeNeighbours(layout, cell, edge);
    if (!neighbours) continue;
    const axis = edgeAxis(edge);
    const grow = new Set(neighbours.map((neighbour) => neighbour.id));
    const cells = layout.cells.flatMap((other) => {
      if (other.id === paneId) return [];
      if (!grow.has(other.id)) return [other];
      const start = edgeLeads(edge) ? cellStart(other, axis) : cellStart(cell, axis);
      return [withCellPosition(other, axis, start, cellSpan(other, axis) + cellSpan(cell, axis))];
    });
    const survivorId = layout.focusedPaneId === paneId ? neighbours[0]!.id : layout.focusedPaneId;
    return {
      layout: normalizePaneLayout({ ...layout, cells, focusedPaneId: survivorId }),
      survivorId,
      reopenBeside: { paneId: neighbours[0]!.id, edge: OPPOSITE_EDGE[edge] },
    };
  }
  return null;
}

export function closeOtherPanes(layout: PaneLayout, paneId: string): PaneLayout {
  const cell = findPane(layout, paneId);
  if (!cell) return layout;
  return {
    columns: [{ id: layout.columns[0]!.id, size: 100 }],
    rows: [{ id: layout.rows[0]!.id, size: 100 }],
    cells: [{ ...cell, column: 0, columnSpan: 1, row: 0, rowSpan: 1 }],
    focusedPaneId: paneId,
  };
}

/** Moves a pane onto `edge` of another pane, keeping its id so its view stays mounted. */
export function movePane(
  layout: PaneLayout,
  paneId: string,
  targetPaneId: string,
  edge: PaneEdge,
  createId: () => string,
): PaneLayout | null {
  const moving = findPane(layout, paneId);
  if (!moving || paneId === targetPaneId || !findPane(layout, targetPaneId)) return null;
  const closed = closePane(layout, paneId);
  if (!closed) return null;
  return splitPane(closed.layout, targetPaneId, edge, moving.target, paneId, createId);
}

/** Exchanges two panes' places; both keep their ids and stay mounted. */
export function swapPanes(layout: PaneLayout, firstId: string, secondId: string): PaneLayout {
  const first = findPane(layout, firstId);
  const second = findPane(layout, secondId);
  if (!first || !second || firstId === secondId) return layout;
  const place = (cell: PaneCell, from: PaneCell): PaneCell => ({
    ...cell,
    column: from.column,
    columnSpan: from.columnSpan,
    row: from.row,
    rowSpan: from.rowSpan,
  });
  return {
    ...layout,
    cells: layout.cells.map((cell) =>
      cell.id === firstId ? place(cell, second) : cell.id === secondId ? place(cell, first) : cell,
    ),
    focusedPaneId: firstId,
  };
}

export function setTrackSizes(
  layout: PaneLayout,
  sizes: { readonly columns?: Record<string, number>; readonly rows?: Record<string, number> },
): PaneLayout {
  const apply = (tracks: ReadonlyArray<PaneTrack>, next: Record<string, number> | undefined) => {
    if (!next) return tracks;
    let changed = false;
    const updated = tracks.map((track) => {
      const size = next[track.id];
      if (size === undefined || !Number.isFinite(size) || size === track.size) return track;
      changed = true;
      return { ...track, size };
    });
    return changed ? updated : tracks;
  };
  const columns = apply(layout.columns, sizes.columns);
  const rows = apply(layout.rows, sizes.rows);
  return columns === layout.columns && rows === layout.rows ? layout : { ...layout, columns, rows };
}

export function equalizePaneLayout(layout: PaneLayout): PaneLayout {
  const equal = (tracks: ReadonlyArray<PaneTrack>) =>
    tracks.map((track) => ({ ...track, size: 100 / tracks.length }));
  return { ...layout, columns: equal(layout.columns), rows: equal(layout.rows) };
}

/** Pixel floor per track: a track holding a pane by itself must fit that pane's minimum. */
export function trackMinimumSize(layout: PaneLayout, axis: PaneAxis, index: number): number {
  const minimum = axis === "column" ? CHAT_PANE_MIN_WIDTH : CHAT_PANE_MIN_HEIGHT;
  return layout.cells.some((cell) => cellStart(cell, axis) === index && cellSpan(cell, axis) === 1)
    ? minimum
    : 0;
}

function minimumExtent(layout: PaneLayout, axis: PaneAxis): number {
  return axisTracks(layout, axis).reduce(
    (sum, _track, index) => sum + trackMinimumSize(layout, axis, index),
    0,
  );
}

/** Whether every pane fits its minimum size in a workspace of `size`. */
export function paneLayoutFits(layout: PaneLayout, size: PaneLayoutSize): boolean {
  return (
    minimumExtent(layout, "column") <= size.width && minimumExtent(layout, "row") <= size.height
  );
}

export function canSplitPane(
  layout: PaneLayout,
  paneId: string,
  edge: PaneEdge,
  size: PaneLayoutSize,
): boolean {
  const pane = findPane(layout, paneId);
  if (!pane || layout.cells.length >= MAX_CHAT_PANES) return false;
  let probeId = 0;
  const probe = insertPane(layout, paneId, edge, pane.target, "probe", () => `probe-${probeId++}`);
  return probe !== null && paneLayoutFits(probe, size);
}

/** Track boundaries that need a gridline, cut into segments around panes that span them. */
export interface PaneGridline {
  readonly type: PaneAxis;
  /** The track the line sits before. */
  readonly index: number;
  readonly from: number;
  readonly span: number;
}

export function paneGridlines(layout: PaneLayout): ReadonlyArray<PaneGridline> {
  const lines: PaneGridline[] = [];
  for (const axis of ["column", "row"] as const) {
    const across: PaneAxis = axis === "column" ? "row" : "column";
    const acrossCount = axisTracks(layout, across).length;
    for (let index = 1; index < axisTracks(layout, axis).length; index += 1) {
      let from: number | null = null;
      for (let position = 0; position <= acrossCount; position += 1) {
        const blocked =
          position === acrossCount ||
          layout.cells.some(
            (cell) =>
              cellStart(cell, axis) < index &&
              cellStart(cell, axis) + cellSpan(cell, axis) > index &&
              cellStart(cell, across) <= position &&
              cellStart(cell, across) + cellSpan(cell, across) > position,
          );
        if (!blocked && from === null) from = position;
        if (blocked && from !== null) {
          lines.push({ type: axis, index, from, span: position - from });
          from = null;
        }
      }
    }
  }
  return lines;
}

/** Structural validity for persisted layouts: panes tile the grid exactly once each. */
export function isValidPaneLayout(layout: PaneLayout): boolean {
  const { columns, rows, cells } = layout;
  if (cells.length === 0 || cells.length > MAX_CHAT_PANES) return false;
  if (columns.length === 0 || rows.length === 0) return false;
  if (columns.length > MAX_CHAT_PANES || rows.length > MAX_CHAT_PANES) return false;
  const validTracks = (tracks: ReadonlyArray<PaneTrack>) =>
    new Set(tracks.map((track) => track.id)).size === tracks.length &&
    tracks.every((track) => Number.isFinite(track.size) && track.size >= 0) &&
    Math.abs(tracks.reduce((sum, track) => sum + track.size, 0) - 100) < 0.5;
  if (!validTracks(columns) || !validTracks(rows)) return false;
  if (new Set(cells.map((cell) => cell.id)).size !== cells.length) return false;
  if (new Set(cells.map((cell) => paneTargetKey(cell.target))).size !== cells.length) return false;
  if (!cells.some((cell) => cell.id === layout.focusedPaneId)) return false;
  const occupied = new Set<string>();
  for (const cell of cells) {
    if (
      !Number.isInteger(cell.column) ||
      !Number.isInteger(cell.row) ||
      !Number.isInteger(cell.columnSpan) ||
      !Number.isInteger(cell.rowSpan) ||
      cell.column < 0 ||
      cell.row < 0 ||
      cell.columnSpan < 1 ||
      cell.rowSpan < 1 ||
      cell.column + cell.columnSpan > columns.length ||
      cell.row + cell.rowSpan > rows.length
    ) {
      return false;
    }
    for (let column = cell.column; column < cell.column + cell.columnSpan; column += 1) {
      for (let row = cell.row; row < cell.row + cell.rowSpan; row += 1) {
        const key = `${column}:${row}`;
        if (occupied.has(key)) return false;
        occupied.add(key);
      }
    }
  }
  return occupied.size === columns.length * rows.length;
}
