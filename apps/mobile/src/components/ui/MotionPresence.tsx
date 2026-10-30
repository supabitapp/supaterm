import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import Animated, {
  Easing,
  ReduceMotion,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { useReducedMotionPreference } from "../../lib/useReducedMotionPreference";
import { isKeyboardMotionSuppressed } from "../../lib/motionInput";
import { MOTION_ENTER_DURATION_MS, MOTION_EXIT_DURATION_MS } from "../../lib/motionTiming";

/** Keeps closing content mounted for its fade; another press retargets the live transition. */
export function MotionPresence({
  visible,
  appear = false,
  offsetY = -4,
  onHidden,
  children,
  style,
  ...props
}: Omit<ComponentProps<typeof Animated.View>, "children"> & {
  readonly children: ReactNode | (() => ReactNode);
  readonly visible: boolean;
  readonly appear?: boolean;
  readonly offsetY?: number;
  readonly onHidden?: () => void;
}) {
  const reducedMotion = useReducedMotionPreference() || isKeyboardMotionSuppressed();
  const [mounted, setMounted] = useState(visible);
  if (visible && !mounted) setMounted(true);
  const visibility = useSharedValue(visible && !appear ? 1 : 0);
  const visibleRef = useRef(visible);
  const onHiddenRef = useRef(onHidden);
  useLayoutEffect(() => {
    visibleRef.current = visible;
    onHiddenRef.current = onHidden;
  }, [onHidden, visible]);
  const hide = useCallback(() => {
    if (visibleRef.current) return;
    setMounted(false);
    onHiddenRef.current?.();
  }, []);
  useLayoutEffect(() => {
    if (!mounted) return;
    if (reducedMotion) {
      visibility.set(visible ? 1 : 0);
      if (!visible) hide();
      return;
    }
    visibility.set(
      withTiming(
        visible ? 1 : 0,
        {
          duration: visible ? MOTION_ENTER_DURATION_MS : MOTION_EXIT_DURATION_MS,
          easing: Easing.bezier(0.32, 0.72, 0, 1),
          reduceMotion: ReduceMotion.Never,
        },
        (finished) => {
          if (finished && !visible) runOnJS(hide)();
        },
      ),
    );
  }, [hide, mounted, reducedMotion, visibility, visible]);
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: visibility.value,
    transform: [{ translateY: (1 - visibility.value) * offsetY }],
  }));
  if (!mounted) return null;
  return (
    <Animated.View
      {...props}
      collapsable={false}
      pointerEvents={visible ? props.pointerEvents : "none"}
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? props.importantForAccessibility : "no-hide-descendants"}
      style={[style, animatedStyle]}
    >
      {typeof children === "function" ? children() : children}
    </Animated.View>
  );
}
