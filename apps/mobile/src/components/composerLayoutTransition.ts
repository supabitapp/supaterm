import { Platform } from "react-native";
import { ReduceMotion, withTiming, type LayoutAnimationFunction } from "react-native-reanimated";

// The bottom-anchored dock position and clipped surface height use the same
// transition so the card grows upward without exposing its final-size content.
// Android gets NO layout transition: the composer rides the keyboard via
// KeyboardStickyView (frame-synced to the IME), and a time-based morph
// running alongside that translate reads as jitter. Snapping the layout and
// letting the keyboard-synced slide be the only motion looks native there.
export const COMPOSER_TRANSITION_DURATION_MS = 220;
// Side panes already animate the dock's width. Nested horizontal layout
// transitions would leave the surface trailing its toolbar's new position.
// Keep the vertical pill/card morph while horizontal layout follows the dock.
const composerHeightTransition: LayoutAnimationFunction = (values) => {
  "worklet";
  const timing = {
    duration: COMPOSER_TRANSITION_DURATION_MS,
    reduceMotion: ReduceMotion.System,
  };
  return {
    initialValues: {
      originX: values.targetOriginX,
      originY: values.currentOriginY,
      width: values.targetWidth,
      height: values.currentHeight,
    },
    animations: {
      originX: values.targetOriginX,
      originY: withTiming(values.targetOriginY, timing),
      width: values.targetWidth,
      height: withTiming(values.targetHeight, timing),
    },
  };
};
export const COMPOSER_LAYOUT_TRANSITION =
  Platform.OS === "android" ? undefined : composerHeightTransition;
