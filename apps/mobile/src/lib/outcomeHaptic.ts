import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

export function playOutcomeHaptic(succeeded: boolean): void {
  const played =
    Platform.OS === "android"
      ? Haptics.performAndroidHapticsAsync(
          succeeded ? Haptics.AndroidHaptics.Confirm : Haptics.AndroidHaptics.Reject,
        )
      : Haptics.notificationAsync(
          succeeded
            ? Haptics.NotificationFeedbackType.Success
            : Haptics.NotificationFeedbackType.Error,
        );
  // Best effort: devices without a haptics engine reject.
  played.catch(() => undefined);
}
