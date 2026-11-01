import type { IconNode } from "@supaterm/icons/nodes";
import type { ColorValue, StyleProp, ViewStyle } from "react-native";
import Svg, { Path } from "react-native-svg";

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
      fill="currentColor"
      stroke="none"
      color={props.color}
      style={props.style}
      testID={props.testID}
      accessibilityLabel={props.accessibilityLabel}
    >
      <Path d={props.node} />
    </Svg>
  );
}
