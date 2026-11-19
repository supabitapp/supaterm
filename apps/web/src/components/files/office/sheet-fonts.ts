import type { DisplayList } from "@betteroffice/xlsx";
import { loadFace, sheetFace } from "./fonts";

/**
 * The metric-compatible faces a workbook's cells draw with, such as Carlito for Calibri, added to the worker's font set
 * under the family name the painter asks for, so text widths, wrapping and overflow match Excel on machines without
 * Office fonts. A family the app ships no face for stays with the browser's own fallback.
 */
export function sheetFonts() {
  const fonts = "fonts" in self ? (self.fonts as FontFaceSet) : undefined;
  const loads = new Map<string, Promise<void>>();

  const load = (family: string, bold: boolean, italic: boolean) => {
    const key = `${family}\u0000${bold}\u0000${italic}`;
    const existing = loads.get(key);

    if (existing) return existing;

    const face = sheetFace(family, bold, italic);
    const loading =
      face && fonts
        ? loadFace(face)
            .then((bytes) =>
              new FontFace(family, bytes, {
                weight: face.weight === 700 ? "700" : "400",
                style: face.style === "italic" ? "italic" : "normal",
              }).load(),
            )
            .then((loaded) => void fonts.add(loaded))
            .catch(() => undefined)
        : Promise.resolve();

    loads.set(key, loading);

    return loading;
  };

  return (lists: readonly DisplayList[]) =>
    Promise.all(
      lists.flatMap((list) =>
        list.commands.flatMap((command) => {
          const family =
            command.op === "text"
              ? (/^"([^"]+)"/.exec(command.fontFamily ?? "")?.[1] ?? command.fontFamily)
              : undefined;

          return command.op === "text" && family
            ? [load(family, !!command.bold, !!command.italic)]
            : [];
        }),
      ),
    );
}
