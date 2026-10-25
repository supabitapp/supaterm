import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import Animated, {
  Easing,
  FadeInUp,
  FadeOut,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { AppSymbolName } from "../../components/ui/AppSymbol";
import { Toast } from "../../components/ui/Toast";
import { MOBILE_MOTION } from "../../lib/designTokens";
import { APP_BAR_HEIGHT } from "../../lib/layoutMetrics";
import { useReduceMotion } from "../../lib/useReducedMotionPreference";
import {
  dismissThreadUndoNotice,
  readThreadUndoNotice,
  useThreadUndoNotice,
} from "./thread-undo-notice";

type Notice = NonNullable<ReturnType<typeof useThreadUndoNotice>>;

const NOTICE_CONTENT = {
  Done: { message: "Marked as Done", icon: "checkmark.circle" },
  Snoozed: { message: "Snoozed", icon: "clock" },
  Unpinned: { message: "Unpinned", icon: "pin.slash" },
} satisfies Record<Notice["action"], { message: string; icon: AppSymbolName }>;

export function ThreadUndoNotice(props: { readonly visible: boolean }) {
  const notice = useThreadUndoNotice();
  // Replacing a notice must also cancel the native gesture tracking the old one.
  const [instance, setInstance] = useState({ notice, key: 0 });
  if (instance.notice !== notice) setInstance({ notice, key: instance.key + 1 });
  if (!props.visible || notice === null) return null;
  return <SwipeableUndoNotice key={instance.key} notice={notice} />;
}

function SwipeableUndoNotice(props: { readonly notice: Notice }) {
  const { notice } = props;
  const content = NOTICE_CONTENT[notice.action];
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const exitTiming = {
    duration: MOBILE_MOTION.exit,
    easing: Easing.in(Easing.cubic),
    reduceMotion,
  };
  const returnTiming = {
    duration: MOBILE_MOTION.adjust,
    easing: Easing.out(Easing.cubic),
    reduceMotion,
  };
  const top = insets.top + APP_BAR_HEIGHT + 8;
  const translation = useSharedValue(0);
  const height = useSharedValue(0);

  const dismiss = () => {
    // A newer action can replace the notice while the swipe is animating out.
    if (readThreadUndoNotice() === notice) dismissThreadUndoNotice();
  };
  // Like a system banner, it leaves through the edge it arrived from.
  const gesture = usePanGesture({
    activeOffsetY: [-10, 10],
    failOffsetX: [-20, 20],
    onUpdate: (event) => {
      translation.set(event.translationY < 0 ? event.translationY : event.translationY * 0.2);
    },
    onDeactivate: (event) => {
      if (
        !event.canceled &&
        (event.translationY < -height.value * 0.4 ||
          (event.velocityY < -600 && event.translationY < 0))
      ) {
        translation.set(
          withTiming(-(top + height.value), exitTiming, (finished) => {
            if (finished) runOnJS(dismiss)();
          }),
        );
      } else {
        translation.set(withTiming(0, returnTiming));
      }
    },
  });
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translation.value }],
  }));

  return (
    <Animated.View
      className="absolute inset-x-3 z-[100]"
      style={{ top }}
      pointerEvents="box-none"
      entering={FadeInUp.duration(MOBILE_MOTION.enter)
        .easing(Easing.out(Easing.cubic))
        .reduceMotion(reduceMotion)}
      exiting={FadeOut.duration(MOBILE_MOTION.exit).reduceMotion(reduceMotion)}
    >
      <GestureDetector gesture={gesture}>
        <Animated.View
          collapsable={false}
          className="self-center"
          style={animatedStyle}
          onLayout={(event) => {
            height.set(event.nativeEvent.layout.height);
          }}
        >
          {/* Keep the dismiss target separate so screen readers can also focus Undo. */}
          <View
            accessible
            accessibilityRole="alert"
            accessibilityLabel={content.message}
            accessibilityActions={[{ name: "escape" }, { name: "dismiss", label: "Dismiss" }]}
            onAccessibilityAction={dismiss}
            pointerEvents="none"
            style={StyleSheet.absoluteFill}
          />
          <Toast
            message={content.message}
            icon={content.icon}
            action={{ label: "Undo", onPress: () => void notice.undo() }}
          />
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
}
