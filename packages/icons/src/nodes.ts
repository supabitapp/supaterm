import type { IconNode } from "./iconNode.ts";

export type { IconNode } from "./iconNode.ts";
export * from "./generated/nodes.ts";

export const ICON_SVG_ROOT_ATTRIBUTES = 'fill="currentColor" stroke="none"';

export function iconSvgElements(node: IconNode): string {
  return `<path d="${node.replaceAll('"', "&quot;")}"/>`;
}
