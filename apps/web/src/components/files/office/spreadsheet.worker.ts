import {
  initWasm,
  openWorkbook,
  toTsv,
  type SheetInfo,
  type WorkbookHandle,
  type XlsxCellRead,
  type XlsxRangeTarget,
} from "@betteroffice/xlsx";
import type { CellRange } from "@betteroffice/xlsx/headless";
import { anchorRange, attempt, lastCell, parseRange, parseSpans } from "./sheet-cells";
import { drawFrame, paintFrame } from "./sheet-frame";
import { frozenSize } from "./sheet-paint";
import type { SheetLayout, SheetMethods, SheetTab } from "./sheet-protocol";
import { serveWorker, Transfer } from "./worker-rpc";

type Opened = {
  readonly workbook: WorkbookHandle;

  info: SheetInfo;

  readonly ends: Map<string, { readonly x: number; readonly y: number } | undefined>;

  readonly surface: OffscreenCanvas;
};

type State = { opened: Opened | undefined };

const state: State = { opened: undefined };

serveWorker<SheetMethods>({
  open: async (input) => {
    if (state.opened) throw new Error("The worker already holds a workbook");

    await initWasm();

    const workbook = openWorkbook(new Uint8Array(input.bytes));
    const info = workbook.sheetInfo();

    state.opened = { workbook, info, ends: new Map(), surface: new OffscreenCanvas(1, 1) };

    const tabs = visibleTabs(workbook, info);

    const first = tabs.find((tab) => tab.index === info.activeSheet) ?? tabs[0];

    if (!first) return undefined;

    return { tabs, layout: show(state.opened, first.index) };
  },
  show: (input) => {
    const opened = required();
    const current = opened.info.activeSheet;
    const layout = attempt(() => show(opened, input.sheet));

    if (layout) return layout;

    attempt(() => show(opened, current));

    throw new Error(`Sheet ${input.sheet} could not open`);
  },
  frame: (input) => {
    const opened = active(input.sheet);
    const frozen = { rows: opened.info.frozenRows, cols: opened.info.frozenCols };
    const viewport = { x: input.x, y: input.y, width: input.width, height: input.height };
    const drawn = drawFrame(opened.workbook, viewport, frozen, input.wider);

    if (!drawn) return undefined;

    const surface = opened.surface;
    const width = Math.ceil(input.offset.x + drawn.viewport.width * input.ratio);
    const height = Math.ceil(input.offset.y + drawn.viewport.height * input.ratio);

    if (surface.width !== width) surface.width = width;

    if (surface.height !== height) surface.height = height;

    const context = surface.getContext("2d");

    if (!context) return undefined;

    paintFrame(context, drawn, { ratio: input.ratio, origin: input.offset });

    const bitmap = surface.transferToImageBitmap();
    const grid = drawn.list.grid;
    const panes = frozenSize(grid, frozen);

    return new Transfer(
      {
        bitmap,
        viewport: drawn.viewport,
        grid,
        hyperlinks: drawn.list.hyperlinks ?? [],
        frozen: panes,
        end: end(opened, input.sheet, panes),
      },
      [bitmap],
    );
  },
  position: (input) => {
    const workbook = required().workbook;
    const cell = input.cell;
    const start = attempt(() => workbook.cellPosition(input.sheet, cell.row, cell.col));

    const next = attempt(() =>
      workbook.cellPosition(
        input.sheet,
        Math.min(cell.row + 1, lastCell.row),
        Math.min(cell.col + 1, lastCell.col),
      ),
    );

    return start && next ? { start, next } : undefined;
  },
  cells: (input) => {
    const cells = read(required(), input.sheet, input.range);
    const range = input.range;

    return Array.from({ length: range.bottom - range.top + 1 }, (_, row) =>
      Array.from(
        { length: range.right - range.left + 1 },
        (_, col) => cells?.[row]?.[col]?.displayText ?? "",
      ),
    );
  },

  copy: (input) => {
    const cells = read(required(), input.sheet, input.range);

    if (!cells) return undefined;

    return toTsv(
      cells.map((row) =>
        row.map((cell) => ({ input: cell.displayText, isFormula: literal(cell) })),
      ),
    );
  },
});

function required() {
  if (!state.opened) throw new Error("The worker holds no workbook");

  return state.opened;
}

function active(sheet: number) {
  const opened = required();

  if (opened.info.activeSheet !== sheet) show(opened, sheet);

  return opened;
}

function show(opened: Opened, sheet: number): SheetLayout {
  opened.workbook.setActiveSheet(sheet);
  opened.info = opened.workbook.sheetInfo();

  return { info: opened.info, ...layout(opened.workbook, sheet) };
}

function layout(workbook: WorkbookHandle, sheet: number) {
  const result = attempt(() =>
    workbook.exportStructured({
      scope: [{ sheet, range: "A1:XFD1048576" }],
      maxCells: 1,
      includeDefinedNames: false,
    }),
  );

  const exported = result?.ok ? result.content.sheets[0] : undefined;

  const charts = (exported?.objects ?? [])
    .filter((object) => object.kind === "chart" && !object.hidden)
    .flatMap((object) => (object.anchor ? anchorRange(object.anchor) : []))

    .flatMap((range) => {
      const corner = attempt(() =>
        workbook.cellPosition(
          sheet,
          Math.min(range.bottom + 1, lastCell.row),
          Math.min(range.right + 1, lastCell.col),
        ),
      );

      return corner ? [corner] : [];
    });

  return {
    used: exported?.usedRange ? parseRange(exported.usedRange) : undefined,
    merges: (exported?.merges ?? []).flatMap((merge) => anchorRange(merge.anchor)),
    hidden: {
      rows: parseSpans(exported?.hiddenRows ?? [], "rows"),
      columns: parseSpans(exported?.hiddenColumns ?? [], "columns"),
    },
    chartWidth: Math.max(0, ...charts.map((corner) => corner.x)),
    chartHeight: Math.max(0, ...charts.map((corner) => corner.y)),
  };
}

function end(
  opened: Opened,
  sheet: number,
  frozen: { readonly width: number; readonly height: number },
) {
  const key = `${sheet}:${frozen.width}:${frozen.height}`;

  if (opened.ends.has(key)) return opened.ends.get(key);

  const measured = measureEnd(opened.workbook, sheet, frozen);

  opened.ends.set(key, measured);

  return measured;
}

function measureEnd(
  workbook: WorkbookHandle,
  sheet: number,
  frozen: { readonly width: number; readonly height: number },
) {
  const last = attempt(() => workbook.cellPosition(sheet, lastCell.row, lastCell.col));

  if (!last) return undefined;

  const grid = attempt(
    () =>
      workbook.displayList({
        x: last.x,
        y: last.y,
        width: frozen.width + 1,
        height: frozen.height + 1,
      }).grid,
  );

  const margin = 2;

  return {
    x:
      last.x +
      Math.max(0, (grid ? (grid.colOffsets[grid.colOffsets.length - 1] ?? 0) : 0) - frozen.width) -
      margin,
    y:
      last.y +
      Math.max(0, (grid ? (grid.rowOffsets[grid.rowOffsets.length - 1] ?? 0) : 0) - frozen.height) -
      margin,
  };
}

function read(opened: Opened, sheet: number, range: CellRange) {
  if ((range.bottom - range.top + 1) * (range.right - range.left + 1) > 200_000) return undefined;
  const target: XlsxRangeTarget = {
    sheetId: opened.info.sheetIds[sheet]!,
    range: {
      kind: "rowCol",
      start: { row: range.top, col: range.left },
      end: { row: range.bottom, col: range.right },
    },
  };

  const result = attempt(() => opened.workbook.readCells({ ranges: [target] }));

  return result?.ok ? result.ranges[0]?.cells : undefined;
}

function visibleTabs(workbook: WorkbookHandle, info: SheetInfo): SheetTab[] {
  const names = info.sheetNames;

  const result = attempt(() =>
    workbook.exportStructured({
      includeHiddenSheets: true,
      includeDefinedNames: false,
      scope: names.map((_, sheet) => ({ sheet, range: "A1" })),
    }),
  );

  const hidden = new Set(
    (result?.ok ? result.content.sheets : [])
      .filter((sheet) => sheet.visibility === "hidden" || sheet.visibility === "veryHidden")
      .flatMap((sheet) => (sheet.anchor.kind === "sheet" ? [sheet.anchor.sheet.index] : [])),
  );

  return names.flatMap((name, index) => (hidden.has(index) ? [] : [{ index, name }]));
}

function literal(cell: XlsxCellRead) {
  return (
    cell.value.kind === "number" && /^[-+][\d\s.,%\p{Sc}]+(?:e[-+]\d+)?$/iu.test(cell.displayText)
  );
}
