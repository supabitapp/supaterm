import { Platform } from "react-native";

export const NATIVE_WORKSPACE_COLUMNS_SUPPORTED = Platform.OS === "ios" && Platform.isPad;

// oxlint-disable-next-line supaterm/no-hookless-use-function -- Non-iOS stub of a hook; the .ios.tsx file calls hooks.
export function useNativeWorkspaceColumnsReady() {
  return true;
}

// oxlint-disable-next-line supaterm/no-hookless-use-function -- Non-iOS stub of a hook; the .ios.tsx file calls hooks.
export function useNativeWorkspaceColumnsSupported() {
  return NATIVE_WORKSPACE_COLUMNS_SUPPORTED;
}
