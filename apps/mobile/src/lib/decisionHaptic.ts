import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

/** Feedback for answering an agent: Android's CONFIRM/REJECT, a light or rigid tap on iOS. */
export function playDecisionHaptic(accepted: boolean): void {
  if (Platform.OS === "android") {
    void Haptics.performAndroidHapticsAsync(
      accepted ? Haptics.AndroidHaptics.Confirm : Haptics.AndroidHaptics.Reject,
    );
    return;
  }
  void Haptics.impactAsync(
    accepted ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Rigid,
  );
}
