import { expect, it } from "vite-plus/test";
import { sheetFace } from "./fonts";

it.each([false, true])(
  "uses the available Comic Relief face for italic spreadsheet text (bold: %s)",
  (bold) => {
    expect(sheetFace("Comic Relief", bold, true)).toMatchObject({
      family: "Comic Relief",
      weight: bold ? 700 : 400,
      style: "normal",
    });
  },
);
