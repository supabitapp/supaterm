import { describe, expect, it } from "vite-plus/test";

import { readMediaPng } from "./mediaContent";

const svgUrl = (body: string) =>
  URL.createObjectURL(
    new Blob([`<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20">${body}</svg>`], {
      type: "image/svg+xml",
    }),
  );

describe("readMediaPng", () => {
  it("converts a plain SVG to PNG", async () => {
    const png = await readMediaPng(svgUrl('<rect width="40" height="20" fill="red"/>'));
    expect(png.type).toBe("image/png");
  });

  it("asks to save an SVG whose HTML content taints the canvas", async () => {
    const tainted = svgUrl(
      '<foreignObject width="40" height="20"><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject>',
    );
    await expect(readMediaPng(tainted)).rejects.toThrow(
      "This image cannot be copied. Try saving it instead.",
    );
  });
});
