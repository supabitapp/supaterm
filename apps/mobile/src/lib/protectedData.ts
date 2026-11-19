import { requireOptionalNativeModule } from "expo";
import { AppState, Platform } from "react-native";

const NativeControls = requireOptionalNativeModule<{
  readonly isProtectedDataAvailable?: () => Promise<boolean>;
}>("SupatermNativeControls");

let protectedDataAvailable: Promise<void> | undefined;

export function whenProtectedDataAvailable() {
  protectedDataAvailable ??= new Promise((resolve) => {
    const isAvailable = NativeControls?.isProtectedDataAvailable;
    if (Platform.OS !== "ios" || AppState.currentState === "active") {
      resolve();
      return;
    }
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") done();
    });
    function done() {
      subscription.remove();
      resolve();
    }
    isAvailable?.().then(
      (available) => {
        if (available) done();
      },
      () => {},
    );
  });
  return protectedDataAvailable;
}
