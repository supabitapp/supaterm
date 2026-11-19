import { Platform } from "react-native";

export const webViewDecelerationRate = Platform.OS === "ios" ? "normal" : undefined;
