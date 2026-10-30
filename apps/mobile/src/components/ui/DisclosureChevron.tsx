import { useLayoutEffect, type ComponentProps } from "react";
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { useReducedMotionPreference } from "../../lib/useReducedMotionPreference";
import { isKeyboardMotionSuppressed } from "../../lib/motionInput";
import { MOTION_ENTER_DURATION_MS } from "../../lib/motionTiming";
import { SymbolView } from "./AppSymbol";

export function DisclosureChevron(
  props: Pick<ComponentProps<typeof SymbolView>, "size" | "tintColor" | "tintColorClassName"> & {
    readonly expanded: boolean;
    readonly collapsedDirection?: "right" | "down";
    readonly duration?: number;
  },
) {
  const reducedMotion = useReducedMotionPreference() || isKeyboardMotionSuppressed();
  const direction = props.collapsedDirection ?? "down";
  const angle = props.expanded ? (direction === "right" ? 90 : 180) : 0;
  const duration = props.duration ?? MOTION_ENTER_DURATION_MS;
  const rotation = useSharedValue(angle);
  useLayoutEffect(() => {
    rotation.set(
      reducedMotion
        ? angle
        : withTiming(angle, {
            duration,
            easing: Easing.bezier(0.645, 0.045, 0.355, 1),
            reduceMotion: ReduceMotion.Never,
          }),
    );
  }, [angle, duration, reducedMotion, rotation]);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${rotation.value}deg` }] }));
  return (
    <Animated.View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[{ width: props.size, height: props.size }, style]}
    >
      <SymbolView
        name={direction === "right" ? "chevron.right" : "chevron.down"}
        size={props.size}
        tintColor={props.tintColor}
        tintColorClassName={props.tintColorClassName}
        type="monochrome"
      />
    </Animated.View>
  );
}
