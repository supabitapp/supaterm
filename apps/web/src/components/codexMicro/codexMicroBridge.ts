/** Desktop builds packaged without Codex Micro omit the bridge, so its presence is the feature flag. */
export function getCodexMicroBridge() {
  if (typeof window === "undefined") return null;
  return window.desktopBridge?.codexMicro ?? null;
}
