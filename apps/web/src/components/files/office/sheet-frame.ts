import {
  paintDisplayList,
  type DisplayList,
  type GridMeta,
  type WorkbookHandle,
} from "@betteroffice/xlsx";
import { attempt } from "./sheet-cells";
import { frozenSize } from "./sheet-paint";
import type { SheetViewport } from "./sheet-protocol";

const maxSplit = 8;

const seamOverlap = 8;

type Tile = {
  readonly list: DisplayList;
  readonly x: number;
  readonly y: number;
  readonly clipX: number;
  readonly clipY: number;
};

export type Frame = {
  readonly list: DisplayList;
  readonly tiles: readonly Tile[];
  readonly viewport: SheetViewport;
};

export function drawFrame(
  workbook: WorkbookHandle,
  viewport: SheetViewport,
  frozen: { readonly rows: number; readonly cols: number },
  wider?: SheetViewport,
): Frame | undefined {
  const around = wider && attempt(() => workbook.displayList(wider));

  if (wider && around)
    return {
      list: around,
      tiles: [{ list: around, x: 0, y: 0, clipX: 0, clipY: 0 }],
      viewport: wider,
    };

  const whole = attempt(() => workbook.displayList(viewport));

  if (whole)
    return { list: whole, tiles: [{ list: whole, x: 0, y: 0, clipX: 0, clipY: 0 }], viewport };

  const columns = attempt(() => workbook.displayList({ ...viewport, height: 1 }).grid);
  const rows = attempt(() => workbook.displayList({ ...viewport, width: 1 }).grid);

  if (!columns || !rows) return undefined;

  const grid = {
    startRow: rows.startRow,
    ...(rows.rowIndices ? { rowIndices: rows.rowIndices } : {}),
    rowOffsets: rows.rowOffsets,
    startCol: columns.startCol,
    ...(columns.colIndices ? { colIndices: columns.colIndices } : {}),
    colOffsets: columns.colOffsets,
  };

  return tiled(workbook, viewport, frozenSize(grid, frozen), grid, 2);
}

export function paintFrame(
  context: OffscreenCanvasRenderingContext2D,
  frame: Frame,
  input: { readonly ratio: number; readonly origin: { readonly x: number; readonly y: number } },
) {
  const ratio = input.ratio;
  const origin = input.origin;

  const painter = context as unknown as CanvasRenderingContext2D;
  const tiled = frame.tiles.length > 1;
  const text = tiled ? new OffscreenCanvas(context.canvas.width, context.canvas.height) : undefined;
  const textContext = text?.getContext("2d");

  frame.tiles.forEach((tile) => {
    const at = { x: origin.x + tile.x * ratio, y: origin.y + tile.y * ratio };
    const list = tiled
      ? { ...tile.list, commands: tile.list.commands.filter((command) => command.op !== "text") }
      : tile.list;

    if (tile.clipX === 0 && tile.clipY === 0) return paintDisplayList(painter, list, ratio, at);

    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.beginPath();
    context.rect(
      Math.round(origin.x + tile.clipX * ratio),
      Math.round(origin.y + tile.clipY * ratio),
      context.canvas.width,
      context.canvas.height,
    );
    context.clip();
    paintDisplayList(painter, list, ratio, at);
    context.restore();
  });

  if (text && textContext)
    frame.tiles.forEach((tile) => {
      textContext.reset();
      paintDisplayList(
        textContext as unknown as CanvasRenderingContext2D,
        {
          ...tile.list,
          width: frame.viewport.width - tile.x,
          height: frame.viewport.height - tile.y,
          commands: tile.list.commands.filter((command) => command.op === "text"),
        },
        ratio,
        { x: origin.x + tile.x * ratio, y: origin.y + tile.y * ratio },
      );
      context.save();
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.beginPath();
      context.rect(
        Math.round(origin.x + tile.clipX * ratio),
        Math.round(origin.y + tile.clipY * ratio),
        context.canvas.width,
        context.canvas.height,
      );
      context.clip();
      context.drawImage(text, 0, 0);
      context.restore();
    });
}

function tiled(
  workbook: WorkbookHandle,
  viewport: SheetViewport,
  panes: { readonly width: number; readonly height: number },
  grid: GridMeta,
  split: number,
): Frame | undefined {
  const columns = segments(viewport.width, panes.width, split);
  const rows = segments(viewport.height, panes.height, split);
  const tiles: Tile[] = [];

  const complete = rows.every((row) =>
    columns.every((column) => {
      const x = column.start === 0 ? 0 : column.start - seamOverlap - panes.width;
      const y = row.start === 0 ? 0 : row.start - seamOverlap - panes.height;

      const right = column.end === viewport.width ? column.end : column.end + seamOverlap;
      const bottom = row.end === viewport.height ? row.end : row.end + seamOverlap;

      const list = attempt(() =>
        workbook.displayList({
          x: viewport.x + x,
          y: viewport.y + y,
          width: right - x,
          height: bottom - y,
        }),
      );

      if (list) tiles.push({ list, x, y, clipX: column.start, clipY: row.start });

      return !!list;
    }),
  );

  if (complete) {
    const hyperlinks = tiles.flatMap((tile) => tile.list.hyperlinks ?? []);

    return {
      list: { width: viewport.width, height: viewport.height, commands: [], grid, hyperlinks },
      tiles,
      viewport,
    };
  }

  if (split >= maxSplit) return undefined;

  return tiled(workbook, viewport, panes, grid, split + 1);
}

function segments(size: number, panes: number, split: number) {
  const starts = Array.from({ length: split }, (_, part) =>
    Math.round((part * size) / split),
  ).filter((start, part) => part === 0 || (start >= panes + seamOverlap && start < size));

  return starts.map((start, part) => ({ start, end: starts[part + 1] ?? size }));
}
