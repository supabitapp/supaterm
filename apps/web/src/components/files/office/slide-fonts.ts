import type {
  PositionedTextRun,
  PresentationHandle,
  SlideDisplayList,
  SlidePrimitive,
} from "@betteroffice/pptx";
import { loadFace, presentationFace, scriptFace } from "./fonts";
import type { DeckText, FallbackScript, FontStyle } from "./slide-text";

type Want =
  | { readonly family: string; readonly script?: undefined }
  | { readonly script: FallbackScript; readonly family?: undefined };

type Face = { readonly want: Want; readonly style: FontStyle; readonly css: string };

export function slideFonts(deck: PresentationHandle, fonts: FontFaceSet) {
  const faces = new Map<number, Face>();
  const names = new Map<string, string>();
  const registered = new Set<string>();
  const loads = new Map<string, Promise<void>>();
  const settled = new Set<string>();

  const prepare = async (want: Want, requested: FontStyle) => {
    const source = want.script
      ? scriptFace(want.script, requested.bold, requested.italic)
      : presentationFace(want.family, requested.bold, requested.italic);

    if (!source) return;

    const style = { bold: source.weight === 700, italic: source.style === "italic" };

    const css = names.get(wantKey(want)) ?? `slide-${names.size}`;
    const key = faceKey(want, style);

    names.set(wantKey(want), css);

    if (registered.has(key)) return;

    const buffer = await loadFace(source).catch(() => undefined);

    if (!buffer) return;

    const browser = await new FontFace(css, buffer, {
      weight: style.bold ? "700" : "400",
      style: style.italic ? "italic" : "normal",
    })
      .load()
      .catch(() => undefined);

    if (!browser) return;

    return () => {
      if (registered.has(key)) return;

      registered.add(key);
      fonts.add(browser);

      const face = {
        family: want.script ? css : want.family,
        ...style,
        bytes: new Uint8Array(buffer),
      };

      faces.set(want.script ? deck.registerFallbackFont(face) : deck.registerFont(face), {
        want,
        style,
        css,
      });
    };
  };

  const request = (want: Want, style: FontStyle) => {
    const key = faceKey(want, style);
    const existing = loads.get(key);

    if (existing) return existing;

    const load = prepare(want, style).then((register) => {
      register?.();
      settled.add(key);
    });

    loads.set(key, load);

    return load;
  };

  const missing = (primitives: readonly SlidePrimitive[]) =>
    textRuns(primitives).flatMap((run) => {
      const face = faces.get(run.fontId);
      const style = { bold: run.bold, italic: run.italic };

      if (!face || sameStyle(face.style, style) || settled.has(faceKey(face.want, style)))
        return [];

      return [{ want: face.want, style }];
    });

  const rename = (primitive: SlidePrimitive): SlidePrimitive => {
    if (primitive.kind === "textBox")
      return {
        ...primitive,
        lines: primitive.lines.map((line) => ({
          ...line,
          runs: line.runs.map((run) => ({
            ...run,
            fontFamily: faces.get(run.fontId)?.css ?? run.fontFamily,
          })),
        })),
      };

    if (primitive.kind === "table" || primitive.kind === "chart")
      return { ...primitive, primitives: primitive.primitives.map(rename) };

    return primitive;
  };

  return {
    load: async (text: DeckText) => {
      const regular = { bold: false, italic: false };

      const families =
        text.families.length > 0 ? text.families : [{ name: "Calibri", styles: [regular] }];

      const wants: { want: Want; style: FontStyle }[] = [
        ...families.flatMap((family) =>
          family.styles.map((style) => ({ want: { family: family.name }, style })),
        ),
        ...text.scripts.map((script) => ({ want: { script }, style: regular })),
      ];

      const registers = await Promise.all(wants.map((entry) => prepare(entry.want, entry.style)));

      registers.forEach((register) => register?.());
      wants.forEach((entry) => {
        const key = faceKey(entry.want, entry.style);

        loads.set(key, Promise.resolve());
        settled.add(key);
      });
    },

    layout: async (index: number) => {
      const settle = async (rounds: number): Promise<SlideDisplayList> => {
        const frame = deck.layoutSlide(index);
        const wanted = rounds === 0 ? [] : missing(frame.primitives);

        if (wanted.length === 0) return { ...frame, primitives: frame.primitives.map(rename) };

        await Promise.all(wanted.map((entry) => request(entry.want, entry.style)));

        return settle(rounds - 1);
      };

      return settle(2);
    },
  };
}

function textRuns(primitives: readonly SlidePrimitive[]): PositionedTextRun[] {
  return primitives.flatMap((primitive) => {
    if (primitive.kind === "textBox") return primitive.lines.flatMap((line) => line.runs);

    if (primitive.kind === "table" || primitive.kind === "chart")
      return textRuns(primitive.primitives);

    return [];
  });
}

function wantKey(want: Want) {
  return want.script ? `script:${want.script}` : `family:${want.family.toLowerCase()}`;
}

function faceKey(want: Want, style: FontStyle) {
  return `${wantKey(want)}|${style.bold}|${style.italic}`;
}

function sameStyle(left: FontStyle, right: FontStyle) {
  return left.bold === right.bold && left.italic === right.italic;
}
