import type { IconNode, IconNodeTag } from "@supaterm/icons/nodes";
import { createElement, type ElementType } from "react";
import type { ColorValue, StyleProp, ViewStyle } from "react-native";
import Svg, { Circle, Ellipse, Line, Path, Polygon, Polyline, Rect } from "react-native-svg";

const ELEMENTS: Readonly<Record<IconNodeTag, ElementType>> = {
  path: Path,
  circle: Circle,
  rect: Rect,
  line: Line,
  ellipse: Ellipse,
  polyline: Polyline,
  polygon: Polygon,
};

export function NodeIconElements(props: { readonly node: IconNode }) {
  return props.node.map(([tag, attrs], index) =>
    createElement(ELEMENTS[tag], { key: index, ...attrs }),
  );
}

export function NodeIcon(props: {
  readonly node: IconNode;
  readonly size?: number;
  readonly color?: ColorValue;
  readonly fill?: ColorValue;
  readonly strokeWidth?: number;
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
  readonly accessibilityLabel?: string;
}) {
  const size = props.size ?? 24;
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={props.fill ?? "none"}
      stroke="currentColor"
      strokeWidth={props.strokeWidth ?? 2}
      strokeLinecap="round"
      strokeLinejoin="round"
      color={props.color}
      style={props.style}
      testID={props.testID}
      accessibilityLabel={props.accessibilityLabel}
    >
      <NodeIconElements node={props.node} />
    </Svg>
  );
}
