import { FillType, Path2D, PathOp, StrokeCap, StrokeJoin } from "@napi-rs/canvas";
import svgpath from "svgpath";
import { ICON_STROKE_WIDTH, type IconNode } from "../src/iconNode.ts";

export const tidyPath = (d: string) => svgpath(d).round(3).toString();

// Each subpath is outlined on its own: path operations misread the overlapping contours
// that stroking several subpaths at once produces.
export function strokeOutline(shape: string): Path2D {
  const outline = new Path2D();
  for (const subpath of shape.match(/M[^M]+/g) ?? []) {
    const stroked = new Path2D(subpath).stroke({
      width: ICON_STROKE_WIDTH,
      cap: StrokeCap.Round,
      join: StrokeJoin.Round,
    });
    outline.op(stroked, PathOp.Union);
  }
  return outline;
}

// One even-odd path that draws the node, for surfaces that cannot stroke.
export function filledPath(node: IconNode): string {
  const body = node.stroke === undefined ? new Path2D() : strokeOutline(node.stroke);
  if (node.fill !== undefined) {
    const fill = new Path2D(node.fill);
    fill.setFillType(FillType.EvenOdd);
    body.op(fill, PathOp.Union);
  }
  return tidyPath(body.toSVGString());
}
