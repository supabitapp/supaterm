import { ICON_STROKE_WIDTH, type IconNode } from "@supaterm/icons/nodes";
import type { ColorValue, StyleProp, ViewStyle } from "react-native";
import Svg, { Path } from "react-native-svg";

export function NodeIconPaths({ node }: { readonly node: IconNode }) {
  return (
    <>
      {node.stroke === undefined ? null : (
        <Path
          d={node.stroke}
          fill="none"
          stroke="currentColor"
          strokeWidth={ICON_STROKE_WIDTH}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {node.fill === undefined ? null : (
        <Path d={node.fill} fill="currentColor" fillRule="evenodd" stroke="none" />
      )}
    </>
  );
}

export function NodeIcon(props: {
  readonly node: IconNode;
  readonly size?: number;
  readonly color?: ColorValue;
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
      color={props.color}
      style={props.style}
      testID={props.testID}
      accessibilityLabel={props.accessibilityLabel}
    >
      <NodeIconPaths node={props.node} />
    </Svg>
  );
}
