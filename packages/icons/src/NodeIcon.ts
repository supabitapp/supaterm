import { createElement } from "react";
import type { IconProps } from "@phosphor-icons/react";
import type { IconNode } from "./iconNode.ts";
import { iconDefaults } from "./iconDefaults.ts";

export function NodeIcon({ node, ...input }: IconProps & { readonly node: IconNode }) {
  const { size, children, ...props } = iconDefaults(input);
  return createElement(
    "svg",
    {
      xmlns: "http://www.w3.org/2000/svg",
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "currentColor",
      stroke: "none",
      ...props,
    },
    createElement("path", { d: node }),
    children,
  );
}
