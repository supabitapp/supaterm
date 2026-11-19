export function supportsNativeLiquidGlass(platform: string, nativeCapabilityAvailable: boolean) {
  return platform === "ios" && nativeCapabilityAvailable;
}
