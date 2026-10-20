import type { DesktopCodexMicroBridge } from "@supaterm/contracts";

/** Desktop builds packaged without Codex Micro omit the bridge, so its presence is the feature flag. */
export function getCodexMicroBridge(): DesktopCodexMicroBridge | null {
  if (typeof window === "undefined") return null;
  return window.desktopBridge?.codexMicro ?? null;
}
