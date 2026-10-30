import {
  fontSizePxFromShorthand,
  glyphRunRect,
  textRunRect,
  type DisplayPage,
  type DisplayPrimitive,
  type GeoRect,
  type GlyphRunPrimitive,
  type TextRunPrimitive,
} from "@betteroffice/docx/layout/render";
import { wordLink } from "./links";
import { lineHeight, type WordSpan } from "./word-protocol";

export type TextMeasure = {
  readonly width: (text: string) => number;

  readonly ascent: number;
  readonly descent: number;
};

export function pageText(page: DisplayPage, measure: TextMeasure): WordSpan[] {
  const body = page.primitives.slice(
    Math.min(page.watermarkPrimitiveCount ?? 0, page.primitives.length),
  );
  const notes = (page.noteAreas ?? []).map((area) => area.primitives ?? []);

  return [page.header?.primitives ?? [], body, ...notes, page.footer?.primitives ?? []].flatMap(
    (region) => regionText(region, page, measure),
  );
}

export function positionTarget(
  pages: readonly DisplayPage[],
  position: number,
  build: (index: number) => DisplayPage | undefined,
) {
  for (const [index, listed] of pages.entries()) {
    const page = listed.unbuilt
      ? (listed.positionSpan?.[1] ?? -1) >= position
        ? build(index)
        : undefined
      : listed;
    const first =
      page && bodyAfter(page, position).toSorted((left, right) => left.start - right.start)[0];

    if (first) return { index, y: first.y };
  }

  return undefined;
}

function bodyAfter(page: DisplayPage, position: number) {
  return page.primitives.flatMap((primitive) => {
    const piece = toPiece(primitive);

    return piece?.start !== undefined && piece.start >= position
      ? [{ start: piece.start, y: piece.rect.y }]
      : [];
  });
}

type Piece = {
  readonly text: string;
  readonly rect: GeoRect;
  readonly baseline: number;
  readonly size: number;
  readonly dir: "ltr" | "rtl";
  readonly href: string | undefined;
  readonly title: string | undefined;
  readonly rotation: number;
  readonly line: string;

  readonly marker: boolean;
  readonly start: number | undefined;
  readonly end: number | undefined;
};

function regionText(
  primitives: readonly DisplayPrimitive[],
  page: DisplayPage,
  measure: TextMeasure,
): WordSpan[] {
  const lines = primitives
    .flatMap((primitive) => {
      const piece = toPiece(primitive);

      return piece ? [piece] : [];
    })
    .reduce<Piece[][]>((groups, piece) => {
      const line = groups.at(-1);
      const first = line?.[0];

      if (
        line &&
        first &&
        first.line === piece.line &&
        Math.abs(first.baseline - piece.baseline) < first.size * 0.6
      ) {
        line.push(piece);

        return groups;
      }

      groups.push([piece]);

      return groups;
    }, [])
    .map((line) => mergeLine(logical(line)));

  return lines.flatMap((line, index) => {
    const next = lines[index + 1]?.[0];
    const last = line.at(-1);

    const wraps = !!next && last?.end !== undefined && next.start === last.end;

    return line.map((piece, at) => {
      const following = line[at + 1];

      if (!following) return toSpan(piece, page, measure, wraps ? undefined : "br");

      return toSpan(piece, page, measure, separated(piece, following) ? "tab" : undefined);
    });
  });
}

function separated(previous: Piece, next: Piece) {
  if (/\s$/u.test(previous.text) || /^\s/u.test(next.text)) return false;

  if (previous.marker) return true;

  const gap = Math.max(
    next.rect.x - (previous.rect.x + previous.rect.w),
    previous.rect.x - (next.rect.x + next.rect.w),
  );

  return gap > next.size * 0.35;
}

function toPiece(primitive: DisplayPrimitive): Piece | undefined {
  if (primitive.kind === "glyphRun") return glyphPiece(primitive);

  if (primitive.kind === "text") return textPiece(primitive);

  return undefined;
}

function glyphPiece(primitive: GlyphRunPrimitive): Piece | undefined {
  if (!primitive.text || primitive.glyphs.length === 0 || primitive.decorative) return undefined;

  const base = primitive.glyphs.find((glyph) => glyph.advance) ?? primitive.glyphs[0];

  return {
    ...common(primitive),
    text: primitive.text,
    rect: glyphRunRect(primitive),
    baseline: base?.y ?? 0,
    size: primitive.size,
  };
}

function textPiece(primitive: TextRunPrimitive): Piece | undefined {
  if (!primitive.text || primitive.decorative) return undefined;

  return {
    ...common(primitive),
    text: primitive.text,
    rect: textRunRect(primitive),
    baseline: primitive.baselineY,
    size: fontSizePxFromShorthand(primitive.font),
  };
}

function common(primitive: GlyphRunPrimitive | TextRunPrimitive) {
  const link = wordLink(primitive.href);

  return {
    dir:
      primitive.rtl || (primitive.bidiLevel ?? 0) % 2 === 1 ? ("rtl" as const) : ("ltr" as const),
    href: link ? primitive.href : undefined,
    title:
      primitive.linkTitle ??
      primitive.tooltip ??
      (link?.kind === "external" ? link.url : undefined),
    rotation: primitive.rotationDeg ?? 0,
    line: `${primitive.lineIndex ?? ""}|${primitive.cell?.cellId ?? `${primitive.cell?.row ?? ""},${primitive.cell?.col ?? ""}`}`,
    marker: primitive.listMarker ?? false,
    start: primitive.docStart,
    end: primitive.docEnd,
  };
}

function logical(line: Piece[]) {
  if (line.some((piece) => piece.start === undefined)) return line;

  return line.toSorted((left, right) => (left.start ?? 0) - (right.start ?? 0));
}

function mergeLine(line: Piece[]) {
  return line.reduce<Piece[]>((merged, piece) => {
    const previous = merged.at(-1);

    if (!previous || !joins(previous, piece)) {
      merged.push(piece);

      return merged;
    }

    const left = Math.min(previous.rect.x, piece.rect.x);
    const right = Math.max(previous.rect.x + previous.rect.w, piece.rect.x + piece.rect.w);

    merged[merged.length - 1] = {
      ...previous,
      text: previous.text + piece.text,
      rect: { ...previous.rect, x: left, w: right - left },
      end: piece.end,
    };

    return merged;
  }, []);
}

function joins(previous: Piece, piece: Piece) {
  if (previous.marker || piece.marker) return false;

  if (previous.href !== piece.href || previous.dir !== piece.dir || previous.title !== piece.title)
    return false;

  if (
    previous.rotation !== 0 ||
    piece.rotation !== 0 ||
    Math.abs(previous.size - piece.size) > 0.01
  )
    return false;

  if (previous.end === undefined || previous.end !== piece.start) return false;

  const gap =
    piece.dir === "rtl"
      ? previous.rect.x - (piece.rect.x + piece.rect.w)
      : piece.rect.x - (previous.rect.x + previous.rect.w);

  return Math.abs(gap) < piece.size * 0.35;
}

function toSpan(
  piece: Piece,
  page: DisplayPage,
  measure: TextMeasure,
  after: WordSpan["after"],
): WordSpan {
  const natural = measure.width(piece.text);
  const stretch = natural > 0 && piece.rect.w > 0 ? piece.rect.w / (natural * piece.size) : 1;

  const above = (lineHeight + measure.ascent - measure.descent) / 2;
  const top = piece.baseline - piece.size * above;
  const width = piece.rect.w / piece.size;
  const middle = (piece.rect.y + piece.rect.h / 2 - top) / piece.size;

  const rotation =
    piece.rotation === 0
      ? ""
      : `translate(${width / 2}em, ${middle}em) rotate(${piece.rotation}deg) translate(${-width / 2}em, ${-middle}em) `;

  return {
    text: piece.text,
    left: piece.rect.x / page.width,
    top: top / page.height,
    size: piece.size / page.width,
    transform: `${rotation}scaleX(${stretch})`,
    dir: piece.dir,
    link: wordLink(piece.href),
    title: piece.title,
    after,
  };
}
