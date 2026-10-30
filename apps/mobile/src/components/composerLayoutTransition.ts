import { Platform } from "react-native";
import { ReduceMotion, withTiming, type LayoutAnimationFunction } from "react-native-reanimated";

// Android uses the keyboard-synced slide; a simultaneous layout morph jitters.
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
