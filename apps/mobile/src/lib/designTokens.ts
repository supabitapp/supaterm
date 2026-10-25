import { MOTION_ENTER_DURATION_MS, MOTION_EXIT_DURATION_MS } from "./motionTiming";

/** Named shapes belong to components; native controls retain platform geometry. */
export const MOBILE_SHAPE = {
  group: { ios: 24, android: 28 },
  toast: 26,
  glass: 32,
} as const;

/** Finite transitions only; each animation must honor useReducedMotionPreference. */
export const MOBILE_MOTION = {
  adjust: 120,
  enter: MOTION_ENTER_DURATION_MS,
  exit: MOTION_EXIT_DURATION_MS,
} as const;
