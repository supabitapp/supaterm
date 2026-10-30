import * as Dialog from "../../components/ui/Dialog";
import { SymbolView } from "../../components/ui/AppSymbol";
import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Pressable, View, type ColorValue } from "react-native";
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useReducedMotionPreference } from "../../lib/useReducedMotionPreference";

import { tryCopyTextWithHaptic } from "../../lib/copyTextWithHaptic";

const COPY_FEEDBACK_DURATION_MS = 1200;

export const CopyTextButton = memo(function CopyTextButton(props: {
  readonly accessibilityLabel: string;
  readonly text: string;
  readonly onCopy?: () => Promise<void>;
  /** Lets a long-press menu wrap the button (`Menu` injects it on Android). */
  readonly onLongPress?: () => void;
  readonly tintColor?: ColorValue;
  readonly copiedTintColor?: ColorValue;
  readonly backgroundColor?: ColorValue;
  readonly borderColor?: ColorValue;
  readonly iconSize?: number;
  readonly buttonSize?: number;
}) {
  const [copied, setCopied] = useState(false);
  const reducedMotion = useReducedMotionPreference();
  const feedback = useSharedValue(0);
  useLayoutEffect(() => {
    feedback.set(
      reducedMotion
        ? copied
          ? 1
          : 0
        : withTiming(copied ? 1 : 0, {
            duration: 120,
            easing: Easing.out(Easing.cubic),
            reduceMotion: ReduceMotion.Never,
          }),
    );
  }, [copied, feedback, reducedMotion]);
  const copyStyle = useAnimatedStyle(() => ({
    opacity: 1 - feedback.value,
    transform: [{ scale: 1 - feedback.value * 0.03 }],
  }));
  const checkStyle = useAnimatedStyle(() => ({
    opacity: feedback.value,
    transform: [{ scale: 0.97 + feedback.value * 0.03 }],
  }));
  const resetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetTimeoutRef.current) {
        clearTimeout(resetTimeoutRef.current);
      }
    },
    [],
  );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={copied ? "Copied" : props.accessibilityLabel}
      disabled={props.text.length === 0}
      hitSlop={8}
      onLongPress={props.onLongPress}
      onPress={async () => {
        try {
          if (props.onCopy) await props.onCopy();
          else if (!(await tryCopyTextWithHaptic(props.text))) {
            // A refused clipboard write is the common failure, and silence reads as success.
            Dialog.alert("Could not copy", "Try again.");
            return;
          }
        } catch {
          Dialog.alert("Could not copy", "Try again.");
          return;
        }
        setCopied(true);
        if (resetTimeoutRef.current) {
          clearTimeout(resetTimeoutRef.current);
        }
        resetTimeoutRef.current = setTimeout(() => {
          setCopied(false);
          resetTimeoutRef.current = null;
        }, COPY_FEEDBACK_DURATION_MS);
      }}
      style={({ pressed }) => ({
        width: props.buttonSize ?? 30,
        height: props.buttonSize ?? 30,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 9,
        borderWidth: props.borderColor ? 1 : 0,
        borderColor: props.borderColor,
        backgroundColor: props.backgroundColor,
        opacity: pressed ? 0.52 : 1,
      })}
    >
      <View
        pointerEvents="none"
        style={{ width: props.iconSize ?? 13, height: props.iconSize ?? 13 }}
      >
        <Animated.View style={[{ position: "absolute", inset: 0 }, copyStyle]}>
          <SymbolView
            name={{ ios: "doc.on.doc", android: "content_copy" }}
            size={props.iconSize ?? 13}
            tintColor={props.tintColor}
            tintColorClassName={props.tintColor ? undefined : "accent-foreground"}
            type="monochrome"
          />
        </Animated.View>
        <Animated.View style={[{ position: "absolute", inset: 0 }, checkStyle]}>
          <SymbolView
            name={{ ios: "checkmark", android: "check" }}
            size={props.iconSize ?? 13}
            tintColor={props.copiedTintColor ?? props.tintColor}
            tintColorClassName={props.tintColor ? undefined : "accent-foreground"}
            type="monochrome"
          />
        </Animated.View>
      </View>
    </Pressable>
  );
});
