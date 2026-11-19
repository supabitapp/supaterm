/** Only the macOS and Linux desktop apps expose the bridge, so its presence is the feature flag. */
export function getSidePulseBridge() {
  if (typeof window === "undefined") return null;
  return window.desktopBridge?.sidePulse ?? null;
}
