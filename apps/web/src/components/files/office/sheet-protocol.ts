import type { SheetInfo } from "@betteroffice/xlsx";
import type { CellAddr, CellRange, GridMeta, HyperlinkRegion } from "@betteroffice/xlsx/headless";
import type { Span } from "./sheet-cells";
import type { Method } from "./worker-rpc";

export type SheetTab = { readonly index: number; readonly name: string };

export type SheetLayout = {
  readonly info: SheetInfo;

  readonly used: CellRange | undefined;
  readonly merges: readonly CellRange[];
  readonly hidden: { readonly rows: readonly Span[]; readonly columns: readonly Span[] };

  readonly chartWidth: number;
  readonly chartHeight: number;
};

export type SheetViewport = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type SheetFrameRequest = {
  readonly sheet: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;

  readonly ratio: number;

  readonly offset: { readonly x: number; readonly y: number };

  readonly wider: SheetViewport | undefined;
};

export type SheetFrame = {
  readonly bitmap: ImageBitmap;

  readonly viewport: SheetViewport;
  readonly grid: GridMeta | undefined;
  readonly hyperlinks: readonly HyperlinkRegion[];

  readonly frozen: { readonly width: number; readonly height: number };

  readonly end: { readonly x: number; readonly y: number } | undefined;
};

export type SheetMethods = {
  readonly open: Method<
    { readonly bytes: ArrayBuffer },
    { readonly tabs: readonly SheetTab[]; readonly layout: SheetLayout } | undefined
  >;

  readonly show: Method<{ readonly sheet: number }, SheetLayout>;

  readonly frame: Method<SheetFrameRequest, SheetFrame | undefined>;

  readonly position: Method<
    { readonly sheet: number; readonly cell: CellAddr },
    | { readonly start: { x: number; y: number }; readonly next: { x: number; y: number } }
    | undefined
  >;

  readonly cells: Method<
    { readonly sheet: number; readonly range: CellRange },
    readonly (readonly string[])[]
  >;

  readonly copy: Method<{ readonly sheet: number; readonly range: CellRange }, string | undefined>;
};
