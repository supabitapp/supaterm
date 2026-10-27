import { createElement, type ReactElement, type SVGProps } from "react";
import type { IconNode } from "./iconNode.ts";

export interface IconProps extends SVGProps<SVGSVGElement> {
  readonly size?: number | string;
}

export type IconComponent = (props: IconProps) => ReactElement;

function isLabelled(props: IconProps): boolean {
  return (
    props["aria-label"] !== undefined ||
    props["aria-labelledby"] !== undefined ||
    props.role !== undefined
  );
}

export function NodeIcon({
  node,
  size = 24,
  strokeWidth = 2,
  children,
  ...props
}: IconProps & { readonly node: IconNode }): ReactElement {
  return createElement(
    "svg",
    {
      xmlns: "http://www.w3.org/2000/svg",
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      "aria-hidden": isLabelled(props) ? undefined : true,
      ...props,
    },
    ...node.map(([tag, attrs], index) => createElement(tag, { key: index, ...attrs })),
    children,
  );
}

export function createIcon(displayName: string, node: IconNode): IconComponent {
  const Icon = (props: IconProps) => NodeIcon({ ...props, node });
  Icon.displayName = displayName;
  return Icon;
}
