import type { XlsxAnchor } from "@betteroffice/xlsx";
import {
  selectionAt,
  type CellAddr,
  type CellRange,
  type Selection,
} from "@betteroffice/xlsx/headless";

export const lastCell = { row: 1048575, col: 16383 };

export function columnName(index: number): string {
  return (
    (index < 26 ? "" : columnName(Math.floor(index / 26) - 1)) +
    String.fromCharCode(65 + (index % 26))
  );
}

export function anchorRange(anchor: XlsxAnchor): CellRange[] {
  if (anchor.kind !== "cell" && anchor.kind !== "range") return [];

  const range = parseRange(anchor.a1);

  return range ? [range] : [];
}

export function parseRange(a1: string): CellRange | undefined {
  const corners = a1.split(":");
  const first = parseCell(corners[0] ?? "");
  const last = corners.length === 1 ? first : parseCell(corners[1] ?? "");

  if (!first || !last) return undefined;

  return {
    top: Math.min(first.row, last.row),
    left: Math.min(first.col, last.col),
    bottom: Math.max(first.row, last.row),
    right: Math.max(first.col, last.col),
  };
}

export function coverMerges(range: CellRange, merges: readonly CellRange[]): CellRange {
  const grown = merges.reduce(
    (current, merge) =>
      overlaps(current, merge)
        ? {
            top: Math.min(current.top, merge.top),
            left: Math.min(current.left, merge.left),
            bottom: Math.max(current.bottom, merge.bottom),
            right: Math.max(current.right, merge.right),
          }
        : current,
    range,
  );

  if (same(grown, range)) return grown;

  return coverMerges(grown, merges);
}

export function settleMerges(
  previous: Selection,
  next: Selection,
  merges: readonly CellRange[],
): Selection {
  if (!collapsed(next)) return next;

  const merge = merges.find((candidate) => contains(candidate, next.focus));

  if (!merge) return next;

  if (!collapsed(previous) || !contains(merge, previous.focus))
    return selectionAt({ row: merge.top, col: merge.left });

  const cell = {
    row: Math.min(
      lastCell.row,
      Math.max(0, past(previous.focus.row, next.focus.row, merge.top, merge.bottom)),
    ),
    col: Math.min(
      lastCell.col,
      Math.max(0, past(previous.focus.col, next.focus.col, merge.left, merge.right)),
    ),
  };

  const landed = merges.find((candidate) => contains(candidate, cell));

  return selectionAt(landed ? { row: landed.top, col: landed.left } : cell);
}

export type Span = { readonly start: number; readonly end: number };

export function parseSpans(spans: readonly string[], axis: "rows" | "columns"): Span[] {
  return spans.flatMap((span) => {
    const [first = "", last = first] = span.split(":");
    const start = axis === "rows" ? Number(first) - 1 : columnIndex(first);
    const end = axis === "rows" ? Number(last) - 1 : columnIndex(last);

    return Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end >= start
      ? [{ start, end }]
      : [];
  });
}

export function skipHidden(
  from: CellAddr,
  selection: Selection,
  hidden: { readonly rows: readonly Span[]; readonly columns: readonly Span[] },
): Selection {
  const focus = {
    row: clear(from.row, selection.focus.row, hidden.rows, lastCell.row),
    col: clear(from.col, selection.focus.col, hidden.columns, lastCell.col),
  };

  if (focus.row === selection.focus.row && focus.col === selection.focus.col) return selection;

  if (collapsed(selection)) return selectionAt(focus);

  return { anchor: selection.anchor, focus };
}

export function attempt<T>(run: () => T): T | undefined {
  try {
    return run();
  } catch {
    return undefined;
  }
}

export function contains(range: CellRange, cell: CellAddr) {
  return (
    cell.row >= range.top &&
    cell.row <= range.bottom &&
    cell.col >= range.left &&
    cell.col <= range.right
  );
}

function parseCell(a1: string): CellAddr | undefined {
  const match = /^\$?([A-Z]{1,3})\$?([1-9]\d*)$/i.exec(a1);

  if (!match) return undefined;

  const col = columnIndex(match[1]!);
  const row = Number(match[2]) - 1;

  if (col > lastCell.col || row > lastCell.row) return undefined;

  return { row, col };
}

function columnIndex(letters: string) {
  if (!/^[A-Z]{1,3}$/i.test(letters)) return Number.NaN;

  return (
    [...letters.toUpperCase()].reduce(
      (total, letter) => total * 26 + letter.charCodeAt(0) - 64,
      0,
    ) - 1
  );
}

function clear(from: number, to: number, spans: readonly Span[], last: number): number {
  const span = spans.find((candidate) => to >= candidate.start && to <= candidate.end);

  if (!span || to === from) return to;

  const next = to > from ? span.end + 1 : span.start - 1;

  if (next < 0 || next > last) return from;

  return clear(from, next, spans, last);
}

function past(from: number, to: number, low: number, high: number) {
  if (to > from) return high + 1;

  if (to < from) return low - 1;

  return from;
}

function collapsed(selection: Selection) {
  return (
    selection.anchor.row === selection.focus.row && selection.anchor.col === selection.focus.col
  );
}

function overlaps(a: CellRange, b: CellRange) {
  return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
}

function same(a: CellRange, b: CellRange) {
  return a.top === b.top && a.left === b.left && a.bottom === b.bottom && a.right === b.right;
}
