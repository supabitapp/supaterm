import { Platform } from "react-native";

export const SYSTEM_FONT_FAMILY = Platform.OS === "ios" ? "System" : "sans-serif";
export const CODE_FONT_FAMILY = Platform.OS === "ios" ? "JetBrainsMono-Regular" : "JetBrainsMono";
