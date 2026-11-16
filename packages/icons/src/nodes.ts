import { ICON_STROKE_WIDTH, type IconNode } from "./iconNode.ts";

export { ICON_STROKE_WIDTH, type IconNode } from "./iconNode.ts";
export * from "./generated/nodes.ts";

export function iconSvgElements(node: IconNode): string {
  const stroke =
    node.stroke === undefined
      ? ""
      : `<path d="${node.stroke}" fill="none" stroke="currentColor" stroke-width="${ICON_STROKE_WIDTH}" stroke-linecap="round" stroke-linejoin="round"/>`;
  const fill =
    node.fill === undefined
      ? ""
      : `<path d="${node.fill}" fill="currentColor" fill-rule="evenodd" stroke="none"/>`;
  return stroke + fill;
}
