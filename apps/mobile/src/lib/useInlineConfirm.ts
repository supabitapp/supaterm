import { NavigationContext } from "@react-navigation/native";
import { createInlineConfirm } from "@supaterm/client-runtime/inline-confirm";
import * as Haptics from "expo-haptics";
import { useContext, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, AppState, type GestureResponderEvent } from "react-native";

type Touch = GestureResponderEvent["nativeEvent"];

const ARMED_HINT = "Tap again to confirm";
const touchListeners = new Set<(touch: Touch) => void>();

const schedule = (ms: number, run: () => void) => {
  const timeout = setTimeout(run, ms);
  return () => clearTimeout(timeout);
};

export function disarmInlineConfirmsOnTouch(event: GestureResponderEvent) {
  for (const listener of touchListeners) listener(event.nativeEvent);
}

export function useInlineConfirm<Key extends string>() {
  const [armed, setArmed] = useState<Key | null>(null);
  const [confirm] = useState(() => createInlineConfirm<Key>(setArmed, schedule));
  const touched = useRef<{ readonly key: Key; readonly touch: Touch } | null>(null);
  const navigation = useContext(NavigationContext);

  useEffect(() => () => confirm.disarm(), [confirm]);

  useEffect(() => {
    if (armed === null) return;
    AccessibilityInfo.announceForAccessibility(ARMED_HINT);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const disarm = () => confirm.disarm();
    const onTouch = (touch: Touch) => {
      if (touched.current?.touch !== touch || touched.current.key !== armed) disarm();
    };
    touchListeners.add(onTouch);
    const removeBlur = navigation?.addListener("blur", disarm);
    const appState = AppState.addEventListener("change", (state) => {
      if (state !== "active") disarm();
    });
    return () => {
      touchListeners.delete(onTouch);
      removeBlur?.();
      appState.remove();
    };
  }, [armed, confirm, navigation]);

  return {
    armed,
    bind: (key: Key, run: () => void) => ({
      ref: confirm.attach(key),
      accessibilityHint: armed === key ? ARMED_HINT : undefined,
      onTouchStart: (event: GestureResponderEvent) => {
        touched.current = { key, touch: event.nativeEvent };
      },
      onPress: (event: GestureResponderEvent) => {
        if (confirm.press(key, event.nativeEvent.timestamp ?? Date.now())) run();
      },
    }),
  };
}
