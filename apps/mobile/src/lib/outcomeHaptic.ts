import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

const ANDROID_CONFIRM_REJECT_MIN_SDK = 30;

export function playOutcomeHaptic(succeeded: boolean) {
  const played =
    Platform.OS === "android" && Platform.Version >= ANDROID_CONFIRM_REJECT_MIN_SDK
      ? Haptics.performAndroidHapticsAsync(
          succeeded ? Haptics.AndroidHaptics.Confirm : Haptics.AndroidHaptics.Reject,
        )
      : Haptics.notificationAsync(
          succeeded
            ? Haptics.NotificationFeedbackType.Success
            : Haptics.NotificationFeedbackType.Error,
        );
  played.catch(() => undefined);
}
