import { Platform } from "react-native";

export function formSheetDetents(initialDetent: number, androidExpandedDetent = 0.92) {
  return [initialDetent, Platform.OS === "ios" ? 1 : androidExpandedDetent];
}
