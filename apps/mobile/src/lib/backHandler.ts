import { useIsFocused } from "@react-navigation/native";
import { useEffect, useEffectEvent } from "react";
import { BackHandler } from "react-native";

export function useHardwareBack(active: boolean, onBack: () => boolean) {
  const focused = useIsFocused();
  const handleBack = useEffectEvent(onBack);
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- subscribes to BackHandler for the focused screen's lifetime
  useEffect(() => {
    if (!active || !focused) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => handleBack());
    return () => subscription.remove();
  }, [active, focused]);
}
