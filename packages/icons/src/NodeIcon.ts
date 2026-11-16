import { createElement, type ComponentProps } from "react";
import { ICON_STROKE_WIDTH, type IconNode } from "./iconNode.ts";

export interface IconProps extends ComponentProps<"svg"> {
  readonly size?: number | string;
}

export function NodeIcon({
  node,
  size = 24,
  children,
  ...props
}: IconProps & { readonly node: IconNode }) {
  const labelled =
    props["aria-label"] !== undefined ||
    props["aria-labelledby"] !== undefined ||
    props.role !== undefined;
  return createElement(
    "svg",
    {
      xmlns: "http://www.w3.org/2000/svg",
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: ICON_STROKE_WIDTH,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      "aria-hidden": labelled ? undefined : true,
      ...props,
    },
    node.stroke === undefined ? null : createElement("path", { d: node.stroke }),
    node.fill === undefined
      ? null
      : createElement("path", {
          d: node.fill,
          fill: "currentColor",
          fillRule: "evenodd",
          stroke: "none",
        }),
    children,
  );
}
