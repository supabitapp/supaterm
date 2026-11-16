import { createElement } from "react";
import type { IconNode } from "./iconNode.ts";
import { NodeIcon, type IconProps } from "./NodeIcon.ts";

export function createIcon(name: string, node: IconNode) {
  function Icon(props: IconProps) {
    return createElement(NodeIcon, { node, ...props });
  }
  Icon.displayName = `${name}Icon`;
  return Icon;
}
