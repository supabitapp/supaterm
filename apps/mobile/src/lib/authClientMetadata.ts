import type { AuthClientPresentationMetadata } from "@supaterm/contracts";
import * as Device from "expo-device";
import { Platform } from "react-native";

export function authClientMetadata(appVersion?: string) {
  return {
    label: "Supaterm Mobile",
    deviceType:
      Device.deviceType === Device.DeviceType.TABLET
        ? "tablet"
        : Device.deviceType === Device.DeviceType.PHONE
          ? "mobile"
          : "unknown",
    ...(Platform.OS === "ios" ? { os: "iOS" } : Platform.OS === "android" ? { os: "Android" } : {}),
    ...(appVersion ? { appVersion } : {}),
  } satisfies AuthClientPresentationMetadata;
}
