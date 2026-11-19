import { AppState } from "react-native";
import { scheduleOnUI } from "react-native-worklets";

function collectUiRuntimeGarbage() {
  "worklet";

  const gc = (globalThis as { gc?: () => void }).gc;
  if (typeof gc === "function") gc();
}

export function installUiRuntimeMemoryWarningGc() {
  const subscription = AppState.addEventListener("memoryWarning", () => {
    scheduleOnUI(collectUiRuntimeGarbage);
  });
  return () => subscription.remove();
}
