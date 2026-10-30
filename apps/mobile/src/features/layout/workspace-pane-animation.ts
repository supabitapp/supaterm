import { Easing, ReduceMotion } from "react-native-reanimated";

export const WORKSPACE_PANE_TIMING = {
  duration: 260,
  easing: Easing.inOut(Easing.cubic),
  reduceMotion: ReduceMotion.System,
} as const;
