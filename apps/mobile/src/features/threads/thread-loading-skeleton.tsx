/**
 * Adapted from https://nativemotion.dev/docs/components/skeleton.
 * MIT License
 * Copyright (c) 2025 nativemotion
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import { useIsFocused } from "@react-navigation/native";
import { useEffect, useId, useState } from "react";
import {
  AccessibilityInfo,
  AppState,
  StyleSheet,
  View,
  type DimensionValue,
  type LayoutChangeEvent,
} from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

/** One clock drives every placeholder and stops when the loading screen is inactive. */
export function useThreadLoadingShimmer() {
  const progress = useSharedValue(0);
  const initialReducedMotion = useReducedMotion();
  const [reduceMotion, setReduceMotion] = useState(initialReducedMotion);
  const [appIsActive, setAppIsActive] = useState(AppState.currentState === "active");
  const screenIsFocused = useIsFocused();
  const showShimmer = !reduceMotion && appIsActive && screenIsFocused;

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduceMotion(enabled);
    });
    const motionSubscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion,
    );
    const appSubscription = AppState.addEventListener("change", (state) => {
      setAppIsActive(state === "active");
    });
    return () => {
      mounted = false;
      motionSubscription.remove();
      appSubscription.remove();
    };
  }, []);

  useEffect(() => {
    progress.set(0);
    if (!showShimmer) return;
    // AccessibilityInfo gates the loop live; Reanimated's system preference is cached at startup.
    progress.set(
      withRepeat(
        withTiming(1, {
          duration: 1_200,
          easing: Easing.linear,
          reduceMotion: ReduceMotion.Never,
        }),
        -1,
        false,
        undefined,
        ReduceMotion.Never,
      ),
    );
    return () => cancelAnimation(progress);
  }, [progress, showShimmer]);

  return { progress, showShimmer };
}

/** Renders a NativeMotion highlight using the loading feed's shared animation clock. */
export function ThreadLoadingSkeleton(props: {
  readonly width?: DimensionValue;
  readonly height?: number;
  readonly radius?: number;
  readonly shimmerColor: string;
  readonly progress: SharedValue<number>;
  readonly showShimmer: boolean;
}) {
  const { progress } = props;
  const measuredWidth = useSharedValue(0);
  const gradientId = `thread-skeleton-${useId().replaceAll(":", "")}`;
  const sweepStyle = useAnimatedStyle(() => ({
    opacity: measuredWidth.value > 0 ? 1 : 0,
    transform: [{ translateX: measuredWidth.value * (progress.value * 2 - 1) }],
  }));

  const onLayout = (event: LayoutChangeEvent) => {
    measuredWidth.set(event.nativeEvent.layout.width);
  };

  return (
    <View
      className="overflow-hidden bg-foreground/10"
      onLayout={onLayout}
      style={{
        width: props.width ?? "100%",
        height: props.height ?? 12,
        borderRadius: props.radius ?? 6,
      }}
    >
      {props.showShimmer ? (
        <Animated.View style={[StyleSheet.absoluteFill, sweepStyle]}>
          <Svg width="100%" height="100%">
            <Defs>
              <LinearGradient id={gradientId} x1="0%" x2="100%" y1="0%" y2="0%">
                <Stop offset="0" stopColor={props.shimmerColor} stopOpacity={0} />
                <Stop offset="0.5" stopColor={props.shimmerColor} stopOpacity={0.7} />
                <Stop offset="1" stopColor={props.shimmerColor} stopOpacity={0} />
              </LinearGradient>
            </Defs>
            <Rect width="100%" height="100%" fill={`url(#${gradientId})`} />
          </Svg>
        </Animated.View>
      ) : null}
    </View>
  );
}
