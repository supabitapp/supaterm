import { pipe } from "effect/Function";
import type { BundledFontProvider } from "@betteroffice/docx/layout";
import {
  loadBundledFontBytes,
  resolveBundledFamilyFace,
  resolveLastResortFace,
  resolveMetricCompatFace,
  resolveScriptFallbackFace,
  type BundledFontFace,
  type BundledFontScript,
} from "@betteroffice/fonts";

function shipped(script: BundledFontScript) {
  return !script.startsWith("cjk-");
}

export function wordFonts(): BundledFontProvider {
  const loader = (face: BundledFontFace | undefined) => (face ? () => loadFace(face) : undefined);

  return {
    resolve: (family, bold, italic) =>
      pipe(resolveMetricCompatFace(family, bold, italic), shippedFace, loader),
    resolveFamily: (family, bold, italic) =>
      pipe(resolveBundledFamilyFace(family, bold, italic), shippedFace, loader),
    resolveScriptFallback: (script, bold, italic) => loader(scriptFace(script, bold, italic)),
    resolveLastResort: (family, bold, italic) => () =>
      loadFace(lastResortFace(family, bold, italic, "word")),
  };
}

export function presentationFace(family: string, bold: boolean, italic: boolean): BundledFontFace {
  return (
    shippedFace(resolveMetricCompatFace(family, bold, italic)) ??
    shippedFace(resolveBundledFamilyFace(family, bold, italic)) ??
    lastResortFace(family, bold, italic, "powerpoint")
  );
}

function shippedFace(face: BundledFontFace | undefined) {
  return face && (!face.script || shipped(face.script)) ? face : undefined;
}

function lastResortFace(
  family: string,
  bold: boolean,
  italic: boolean,
  office: "word" | "powerpoint",
) {
  const face = resolveLastResortFace(family, bold, italic, office);

  if (shippedFace(face)) return face;

  const base = family
    .trim()
    .split(/[\s-]+/)
    .slice(0, -1)
    .join(" ");

  return (
    shippedFace(resolveLastResortFace(base, bold, italic, office)) ??
    resolveLastResortFace("", bold, italic, office)
  );
}

export function scriptFace(script: BundledFontScript, bold: boolean, italic: boolean) {
  return shipped(script) ? resolveScriptFallbackFace(script, bold, italic) : undefined;
}

export function loadFace(face: BundledFontFace) {
  return loadBundledFontBytes(face);
}
