import type { IconNode } from "./iconNode.ts";

export type { IconNode, IconNodeAttrs, IconNodeTag } from "./iconNode.ts";
export * from "./generated/nodes.ts";

// Root attributes every icon's elements are drawn relative to, for markup outside React.
export const ICON_SVG_ROOT_ATTRIBUTES =
  'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

const kebab = (name: string) => name.replaceAll(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

// For surfaces that need SVG markup rather than components: sprites, canvas, injected
// pages, and rasterized assets. Wrap the result in an element carrying
// ICON_SVG_ROOT_ATTRIBUTES (or the same defaults) and a `color` for currentColor.
export function iconSvgElements(node: IconNode): string {
  return node
    .map(([tag, attrs]) => {
      const attributes = Object.entries(attrs)
        .filter(([name]) => name !== "key")
        .map(([name, value]) => `${kebab(name)}="${value.replaceAll('"', "&quot;")}"`)
        .join(" ");
      return `<${tag} ${attributes}/>`;
    })
    .join("");
}
