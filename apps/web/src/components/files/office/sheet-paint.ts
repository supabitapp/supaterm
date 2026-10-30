import { rangeRect, type CellRange, type GridMeta } from "@betteroffice/xlsx/headless";
import { columnName } from "./sheet-cells";
import type { SheetFrame, SheetFrameRequest } from "./sheet-protocol";

const colours = {
  header: "#f5f5f5",
  label: "#5c5c5c",
  line: "#d4d4d4",
  edge: "#bdbdbd",
  corner: "#c8c8c8",
  selectedHeader: "#d3ecdd",
  selectedLabel: "#185c37",
  accent: "#217346",
  selection: "rgba(33, 115, 70, 0.12)",
};

const font = "11px ui-sans-serif, system-ui, sans-serif";

export const headerHeight = 20;

export type Headers = { readonly width: number; readonly height: number };

export function frozenSize(
  grid: GridMeta | undefined,
  frozen: { readonly rows: number; readonly cols: number },
) {
  if (!grid) return { width: 0, height: 0 };

  const pane = (
    offsets: readonly number[],
    start: number,
    indices: readonly number[] | undefined,
    count: number,
  ) => {
    if (count === 0) return 0;

    const first = offsets.findIndex(
      (_, position) =>
        position === offsets.length - 1 || trackIndex(start, indices, position) >= count,
    );

    return Math.max(0, offsets[first] ?? 0);
  };

  return {
    width: pane(grid.colOffsets, grid.startCol, grid.colIndices, frozen.cols),
    height: pane(grid.rowOffsets, grid.startRow, grid.rowIndices, frozen.rows),
  };
}

export type Painted = { readonly request: SheetFrameRequest; readonly frame: SheetFrame };

export function paintCells(
  context: CanvasRenderingContext2D,
  painted: Painted,
  input: {
    readonly ratio: number;
    readonly headers: Headers;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  },
) {
  const request = painted.request;
  const bitmap = painted.frame.bitmap;
  const panes = painted.frame.frozen;
  const ratio = input.ratio;
  const scale = ratio / request.ratio;
  const origin = { x: input.headers.width * ratio, y: input.headers.height * ratio };

  const columns = [
    { start: 0, end: Math.min(panes.width, input.width), shift: 0 },
    { start: panes.width, end: input.width, shift: painted.frame.viewport.x - input.x },
  ];

  const rows = [
    { start: 0, end: Math.min(panes.height, input.height), shift: 0 },
    { start: panes.height, end: input.height, shift: painted.frame.viewport.y - input.y },
  ];

  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, context.canvas.width, context.canvas.height);

  rows.forEach((row) =>
    columns.forEach((column) => {
      if (row.end <= row.start || column.end <= column.start) return;

      const left = Math.round(origin.x + column.start * ratio);
      const top = Math.round(origin.y + row.start * ratio);

      context.save();
      context.beginPath();
      context.rect(
        left,
        top,
        Math.round(origin.x + column.end * ratio) - left,
        Math.round(origin.y + row.end * ratio) - top,
      );
      context.clip();

      context.drawImage(
        bitmap,
        Math.round(origin.x + column.shift * ratio - request.offset.x * scale),
        Math.round(origin.y + row.shift * ratio - request.offset.y * scale),
        bitmap.width * scale,
        bitmap.height * scale,
      );
      context.restore();
    }),
  );

  context.restore();
}

export function shiftGrid(
  grid: GridMeta,
  frozen: { readonly rows: number; readonly cols: number },
  panes: { readonly width: number; readonly height: number },
  shift: { readonly x: number; readonly y: number },
): GridMeta {
  if (shift.x === 0 && shift.y === 0) return grid;

  const axis = (
    offsets: readonly number[],
    start: number,
    indices: readonly number[] | undefined,
    count: number,
    edge: number,
    by: number,
  ) => {
    const fixed =
      count === 0
        ? -1
        : offsets.findIndex((_, position) => trackIndex(start, indices, position) >= count);

    return offsets.map((offset, position) => {
      if (fixed === -1 && count > 0) return offset;

      if (position <= fixed) return offset;

      return count === 0 ? offset + by : Math.max(edge, offset + by);
    });
  };

  return {
    ...grid,
    colOffsets: axis(
      grid.colOffsets,
      grid.startCol,
      grid.colIndices,
      frozen.cols,
      panes.width,
      shift.x,
    ),
    rowOffsets: axis(
      grid.rowOffsets,
      grid.startRow,
      grid.rowIndices,
      frozen.rows,
      panes.height,
      shift.y,
    ),
  };
}

function trackIndex(start: number, indices: readonly number[] | undefined, position: number) {
  return indices?.[position] ?? start + position;
}

export function paintHeaders(
  context: CanvasRenderingContext2D,
  input: {
    readonly grid: GridMeta;
    readonly ratio: number;
    readonly headers: Headers;
    readonly width: number;
    readonly height: number;
    readonly selected: CellRange | undefined;
  },
) {
  const grid = input.grid;
  const headers = input.headers;
  const selected = input.selected;

  context.save();
  context.setTransform(input.ratio, 0, 0, input.ratio, 0, 0);
  context.fillStyle = colours.header;
  context.fillRect(0, 0, input.width, headers.height);
  context.fillRect(0, 0, headers.width, input.height);
  context.font = font;
  context.textAlign = "center";
  context.textBaseline = "middle";

  grid.colOffsets.slice(0, -1).forEach((offset, position) => {
    const index = trackIndex(grid.startCol, grid.colIndices, position);

    paintHeader(context, {
      x: headers.width + offset,
      y: 0,
      width: grid.colOffsets[position + 1]! - offset,
      height: headers.height,
      label: columnName(index),
      selected: !!selected && index >= selected.left && index <= selected.right,
      clip: { x: headers.width, width: input.width - headers.width },
    });
  });
  grid.rowOffsets.slice(0, -1).forEach((offset, position) => {
    const index = trackIndex(grid.startRow, grid.rowIndices, position);

    paintHeader(context, {
      x: 0,
      y: headers.height + offset,
      width: headers.width,
      height: grid.rowOffsets[position + 1]! - offset,
      label: String(index + 1),
      selected: !!selected && index >= selected.top && index <= selected.bottom,
      clip: { y: headers.height, height: input.height - headers.height },
    });
  });

  line(context, colours.edge, 0, headers.height, input.width, headers.height);
  line(context, colours.edge, headers.width, 0, headers.width, input.height);

  context.fillStyle = colours.corner;
  context.beginPath();
  context.moveTo(headers.width - 4, headers.height - 12);
  context.lineTo(headers.width - 4, headers.height - 4);
  context.lineTo(headers.width - 12, headers.height - 4);
  context.closePath();
  context.fill();
  context.restore();
}

export function paintSelection(
  context: CanvasRenderingContext2D,
  input: {
    readonly grid: GridMeta;
    readonly ratio: number;
    readonly headers: Headers;
    readonly width: number;
    readonly height: number;
    readonly range: CellRange;
    readonly active: CellRange;
  },
) {
  const range = rangeRect(input.grid, input.range);

  if (!range) return;

  const active = rangeRect(input.grid, input.active);

  context.save();
  context.setTransform(
    input.ratio,
    0,
    0,
    input.ratio,
    input.headers.width * input.ratio,
    input.headers.height * input.ratio,
  );
  context.beginPath();
  context.rect(0, 0, input.width, input.height);
  context.clip();

  if (!sameRect(range, active)) {
    context.beginPath();
    context.rect(range.x, range.y, range.w, range.h);

    if (active) context.rect(active.x, active.y, active.w, active.h);

    context.fillStyle = colours.selection;
    context.fill("evenodd");
  }

  context.strokeStyle = colours.accent;
  context.lineWidth = 2;
  context.strokeRect(range.x, range.y, range.w, range.h);
  context.restore();
}

function paintHeader(
  context: CanvasRenderingContext2D,
  header: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly label: string;
    readonly selected: boolean;
    readonly clip: {
      readonly x?: number;
      readonly y?: number;
      readonly width?: number;
      readonly height?: number;
    };
  },
) {
  if (header.width <= 0 || header.height <= 0) return;

  const columns = header.y === 0;

  context.save();
  context.beginPath();
  context.rect(
    header.clip.x ?? header.x,
    header.clip.y ?? header.y,
    header.clip.width ?? header.width,
    header.clip.height ?? header.height,
  );
  context.clip();

  if (header.selected) {
    context.fillStyle = colours.selectedHeader;
    context.fillRect(header.x, header.y, header.width, header.height);
    context.fillStyle = colours.accent;
    context.fillRect(
      columns ? header.x : header.x + header.width - 2,
      columns ? header.y + header.height - 2 : header.y,
      columns ? header.width : 2,
      columns ? 2 : header.height,
    );
  }

  if (columns ? context.measureText(header.label).width + 2 <= header.width : header.height >= 9) {
    context.fillStyle = header.selected ? colours.selectedLabel : colours.label;
    context.fillText(header.label, header.x + header.width / 2, header.y + header.height / 2 + 0.5);
  }

  context.restore();

  const x = columns ? header.x + header.width : header.x;
  const y = columns ? header.y : header.y + header.height;

  line(
    context,
    colours.line,
    x,
    y,
    columns ? x : x + header.width,
    columns ? y + header.height : y,
  );
}

function line(
  context: CanvasRenderingContext2D,
  colour: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
) {
  context.strokeStyle = colour;
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(x1, y1);
  context.lineTo(x2, y2);
  context.stroke();
}

function sameRect(a: { x: number; y: number; w: number; h: number }, b: typeof a | null) {
  return !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}
