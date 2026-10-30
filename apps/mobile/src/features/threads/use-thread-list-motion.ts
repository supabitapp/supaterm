import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import {
  Easing,
  ReduceMotion,
  runOnUI,
  useSharedValue,
  withTiming,
  type EntryAnimationsValues,
  type ExitAnimationsValues,
  type LayoutAnimationFunction,
} from "react-native-reanimated";

import { useReducedMotionPreference } from "../../lib/useReducedMotionPreference";
import {
  shouldAnimateThreadList,
  THREAD_LIST_MOTION_DURATION,
  type ThreadListMotionItem,
} from "./thread-list-motion";
import { isKeyboardMotionSuppressed } from "../../lib/motionInput";
import { MOTION_ENTER_DURATION_MS, MOTION_EXIT_DURATION_MS } from "../../lib/motionTiming";

/** Uses LegendList's recycling guards while animating only visible cells' transforms and opacity. */
export function useThreadListMotion(input: {
  readonly items: ReadonlyArray<ThreadListMotionItem>;
  readonly scope: string;
  readonly searching: boolean;
  readonly scrolling: boolean;
  readonly ready: boolean;
  readonly doneLimit?: number;
}) {
  const { items, scope, searching, scrolling, ready, doneLimit = 0 } = input;
  const reducedMotion = useReducedMotionPreference();
  const frame = useMemo(
    () => ({ items: items.map(({ key, expanded }) => ({ key, expanded })), scope, doneLimit }),
    [items, scope, doneLimit],
  );
  const previous = useRef<typeof frame | null>(null);
  const deadline = useSharedValue(0);
  const prepare = useCallback(() => {
    if (!ready || reducedMotion || scrolling || searching || isKeyboardMotionSuppressed()) return;
    runOnUI(() => {
      "worklet";
      deadline.set(performance.now() + 300);
    })();
  }, [deadline, ready, reducedMotion, scrolling, searching]);
  useLayoutEffect(() => {
    const animate =
      ready &&
      previous.current !== null &&
      !isKeyboardMotionSuppressed() &&
      shouldAnimateThreadList({
        items: frame.items,
        scope: frame.scope,
        previousItems: previous.current.items,
        previousScope: previous.current.scope,
        searching,
        previousDoneLimit: previous.current.doneLimit,
        doneLimit: frame.doneLimit,
      });
    previous.current = ready ? frame : null;
    // Bound eligibility without scheduling an animation just to expire a flag.
    runOnUI((allow: boolean) => {
      "worklet";
      deadline.set(allow ? performance.now() + 300 : 0);
    })(animate && !reducedMotion && !scrolling);
  }, [deadline, frame, scrolling, searching, reducedMotion, ready]);

  return useMemo(() => {
    const timing = {
      duration: THREAD_LIST_MOTION_DURATION,
      easing: Easing.bezier(0.645, 0.045, 0.355, 1),
      reduceMotion: ReduceMotion.Never,
    };
    const entryTiming = {
      ...timing,
      duration: MOTION_ENTER_DURATION_MS,
      easing: Easing.bezier(0.32, 0.72, 0, 1),
    };
    const layout: LayoutAnimationFunction = (values) => {
      "worklet";
      const visible =
        values.currentGlobalOriginY + values.currentHeight > 0 &&
        values.currentGlobalOriginY < values.windowHeight &&
        values.targetGlobalOriginY + values.targetHeight > 0 &&
        values.targetGlobalOriginY < values.windowHeight;
      const offset =
        performance.now() < deadline.value && visible
          ? values.currentOriginY - values.targetOriginY
          : 0;
      const geometry = {
        originX: values.targetOriginX,
        originY: values.targetOriginY,
        width: values.targetWidth,
        height: values.targetHeight,
      };
      return {
        initialValues: { ...geometry, transform: [{ translateY: offset }] },
        animations: {
          ...geometry,
          transform: [{ translateY: offset === 0 ? 0 : withTiming(0, timing) }],
        },
      };
    };
    const entering = (values: EntryAnimationsValues) => {
      "worklet";
      const animateEntry =
        performance.now() < deadline.value &&
        values.targetGlobalOriginY + values.targetHeight > 0 &&
        values.targetGlobalOriginY < values.windowHeight;
      return {
        initialValues: {
          opacity: animateEntry ? 0 : 1,
          transform: [{ translateY: animateEntry ? -4 : 0 }],
        },
        animations: {
          opacity: animateEntry ? withTiming(1, entryTiming) : 1,
          transform: [{ translateY: animateEntry ? withTiming(0, entryTiming) : 0 }],
        },
      };
    };
    const exiting = (values: ExitAnimationsValues) => {
      "worklet";
      const animateExit =
        performance.now() < deadline.value &&
        values.currentGlobalOriginY + values.currentHeight > 0 &&
        values.currentGlobalOriginY < values.windowHeight;
      return {
        initialValues: { opacity: 1 },
        animations: {
          opacity: animateExit
            ? withTiming(0, { ...entryTiming, duration: MOTION_EXIT_DURATION_MS })
            : 0,
        },
      };
    };
    return { layout, entering, exiting, prepare };
  }, [deadline, prepare]);
}
