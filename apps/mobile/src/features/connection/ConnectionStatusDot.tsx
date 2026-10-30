import { useEffect } from "react";
import { View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { useForegroundMotion } from "../../lib/useForegroundMotion";

import type { RemoteClientConnectionState } from "../../lib/connection";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import { themeColorWithAlpha, type MobileThemeVariables } from "../../lib/mobileTheme";

export type ConnectionStatusDotState = RemoteClientConnectionState;

function statusDotTone(
  state: ConnectionStatusDotState,
  theme: MobileThemeVariables,
  dark: boolean,
): {
  readonly dotColor: string;
  readonly haloColor: string;
} {
  switch (state) {
    case "available":
    case "unsupported":
      return {
        dotColor: theme["--color-icon-muted"],
        haloColor: themeColorWithAlpha(theme["--color-icon-muted"], 0.42),
      };
    case "connected":
      return {
        dotColor: dark ? "#34d399" : "#059669",
        haloColor: themeColorWithAlpha(dark ? "#34d399" : "#059669", 0.48),
      };
    case "connecting":
    case "reconnecting":
      return {
        dotColor: theme["--color-warning-foreground"],
        haloColor: themeColorWithAlpha(theme["--color-warning-foreground"], 0.5),
      };
    case "offline":
    case "error":
      return {
        dotColor: theme["--color-danger-foreground"],
        haloColor: themeColorWithAlpha(theme["--color-danger-foreground"], 0.48),
      };
  }
}

function usePulseAnimation(pulse: boolean) {
  const pulseProgress = useSharedValue(0);

  useEffect(() => {
    if (pulse) {
      pulseProgress.set(
        withRepeat(
          withTiming(1, {
            duration: 1100,
            easing: Easing.out(Easing.cubic),
            reduceMotion: ReduceMotion.Never,
          }),
          -1,
          false,
          undefined,
          ReduceMotion.Never,
        ),
      );
      return () => cancelAnimation(pulseProgress);
    }

    cancelAnimation(pulseProgress);
    pulseProgress.set(0);
  }, [pulse, pulseProgress]);

  return pulseProgress;
}

export function ConnectionStatusDot(props: {
  readonly state: ConnectionStatusDotState;
  readonly pulse: boolean;
  readonly size?: number;
}) {
  const motionEnabled = useForegroundMotion();
  const pulse = props.pulse && motionEnabled;
  const pulseProgress = usePulseAnimation(pulse);
  const { themeAppearance, themeVariables } = useAppearancePreferences();
  const tone = statusDotTone(props.state, themeVariables, themeAppearance === "dark");
  const dotSize = props.size ?? 10;
  const haloSize = dotSize + 4;
  const containerSize = haloSize + 4;

  const haloStyle = useAnimatedStyle(() => ({
    opacity: pulse ? 0.14 + (1 - pulseProgress.value) * 0.3 : 0,
    transform: [{ scale: 0.78 + pulseProgress.value * 1.16 }],
  }));

  return (
    <View
      style={{
        width: containerSize,
        height: containerSize,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Animated.View
        style={[
          haloStyle,
          {
            position: "absolute",
            width: haloSize,
            height: haloSize,
            borderRadius: haloSize / 2,
            backgroundColor: tone.haloColor,
          },
        ]}
      />
      <View
        style={{
          width: dotSize,
          height: dotSize,
          borderRadius: dotSize / 2,
          backgroundColor: tone.dotColor,
        }}
      />
    </View>
  );
}
